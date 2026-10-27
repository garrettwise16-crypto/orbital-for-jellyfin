using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging;

namespace Orbital.Sports;

/// <summary>
/// Runs the bundled sports service as a child process on 127.0.0.1 with a fresh random port and secret, restarts it
/// with backoff if it exits, and stops it with Jellyfin. The child also exits by itself if Jellyfin disappears.
/// Kept free of Jellyfin types so it can be exercised directly.
/// </summary>
public sealed class ServiceSupervisor : IDisposable
{
    private readonly string _executable;
    private readonly string _dataDir;
    private readonly Func<string> _jellyfinUrl;
    private readonly ILogger _logger;
    private readonly CancellationTokenSource _stop = new();
    private readonly object _lock = new();
    private Process? _process;
    private Task? _loop;

    public ServiceSupervisor(string executable, string dataDir, Func<string> jellyfinUrl, ILogger logger)
    {
        _executable = executable;
        _dataDir = dataDir;
        _jellyfinUrl = jellyfinUrl;
        _logger = logger;
    }

    public Uri? BaseUri { get; private set; }

    public string Secret { get; private set; } = string.Empty;

    public int Restarts { get; private set; }

    public string? LastError { get; private set; }

    public int? ProcessId { get { lock (_lock) { return _process is { HasExited: false } p ? p.Id : null; } } }

    public bool Exists => File.Exists(_executable);

    public void Start()
    {
        if (_loop is not null)
        {
            return;
        }

        Directory.CreateDirectory(_dataDir);
        _loop = Task.Run(() => RunAsync(_stop.Token));
    }

    /// <summary>Waits until the service answers /health, or the timeout passes.</summary>
    public async Task<bool> WaitHealthyAsync(TimeSpan timeout, CancellationToken token = default)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var until = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < until && !token.IsCancellationRequested)
        {
            var uri = BaseUri;
            if (uri is not null)
            {
                try
                {
                    using var response = await client.GetAsync(new Uri(uri, "/health"), token).ConfigureAwait(false);
                    if (response.IsSuccessStatusCode)
                    {
                        return true;
                    }
                }
                catch (HttpRequestException)
                {
                }
                catch (TaskCanceledException)
                {
                }
            }

            await Task.Delay(250, token).ConfigureAwait(false);
        }

        return false;
    }

    private async Task RunAsync(CancellationToken token)
    {
        var backoff = TimeSpan.FromSeconds(2);
        while (!token.IsCancellationRequested)
        {
            var started = DateTime.UtcNow;
            try
            {
                await RunOnceAsync(token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex) when (ex is IOException or InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                LastError = ex.Message;
                _logger.LogWarning("Orbital Sports service could not start: {Message}", ex.Message);
            }

            if (token.IsCancellationRequested)
            {
                break;
            }

            BaseUri = null;
            Restarts++;
            backoff = DateTime.UtcNow - started > TimeSpan.FromMinutes(5) ? TimeSpan.FromSeconds(2)
                : TimeSpan.FromSeconds(Math.Min(60, backoff.TotalSeconds * 2));
            _logger.LogInformation("Orbital Sports service stopped; restarting in {Seconds} s", backoff.TotalSeconds);
            try
            {
                await Task.Delay(backoff, token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task RunOnceAsync(CancellationToken token)
    {
        var port = FreePort();
        Secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var info = new ProcessStartInfo(_executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Path.GetDirectoryName(_executable)!,
        };
        info.Environment["PORT"] = port.ToString(System.Globalization.CultureInfo.InvariantCulture);
        info.Environment["ORBITAL_BRIDGE_SECRET"] = Secret;
        info.Environment["JELLYFIN_URL"] = _jellyfinUrl();
        info.Environment["SPORTS_DATA_DIR"] = _dataDir;
        info.Environment["ORBITAL_PARENT_PID"] = Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        info.Environment["SPORTS_BIND"] = "127.0.0.1";

        var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        // Wait on the exit event, not WaitForExit: that also waits for the output pipes to close, which a
        // surviving grandchild can hold open forever.
        var exited = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        process.Exited += (_, _) => exited.TrySetResult();
        process.OutputDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) { _logger.LogDebug("Orbital Sports: {Line}", e.Data); } };
        process.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) { LastError = e.Data; _logger.LogDebug("Orbital Sports: {Line}", e.Data); } };
        if (!process.Start())
        {
            throw new InvalidOperationException("process did not start");
        }

        lock (_lock)
        {
            _process = process;
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        BaseUri = new Uri("http://127.0.0.1:" + port.ToString(System.Globalization.CultureInfo.InvariantCulture));
        _logger.LogInformation("Orbital Sports service started (pid {Pid}, port {Port})", process.Id, port);
        try
        {
            if (process.HasExited)
            {
                exited.TrySetResult();
            }

            await exited.Task.WaitAsync(token).ConfigureAwait(false);
            LastError = "exited with code " + process.ExitCode.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        finally
        {
            Kill(process);
            lock (_lock)
            {
                _process = null;
            }

            process.Dispose();
        }
    }

    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            return ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        finally
        {
            listener.Stop();
        }
    }

    private static void Kill(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit(5000);
            }
        }
        catch (InvalidOperationException)
        {
        }
        catch (System.ComponentModel.Win32Exception)
        {
        }
    }

    public void Stop()
    {
        _stop.Cancel();
        lock (_lock)
        {
            if (_process is not null)
            {
                Kill(_process);
            }
        }

        try
        {
            _loop?.Wait(TimeSpan.FromSeconds(10));
        }
        catch (AggregateException)
        {
        }

        BaseUri = null;
    }

    public void Dispose()
    {
        Stop();
        _stop.Dispose();
    }
}

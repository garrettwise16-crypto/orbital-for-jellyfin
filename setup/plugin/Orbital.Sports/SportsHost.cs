using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Orbital.Sports;

/// <summary>Registers the sports service host with Jellyfin.</summary>
public sealed class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddHostedService<SportsHost>();
    }
}

/// <summary>
/// Where /sports/api/* is answered: an external service (containers, set in the plugin settings or
/// ORBITAL_SPORTS_URL) or the bundled service started next to Jellyfin.
/// </summary>
public sealed class SportsHost : IHostedService, IDisposable
{
    private readonly ILogger<SportsHost> _logger;
    private readonly IServerApplicationHost _host;
    private readonly IApplicationPaths _paths;
    private ServiceSupervisor? _supervisor;

    public SportsHost(ILogger<SportsHost> logger, IServerApplicationHost host, IApplicationPaths paths)
    {
        _logger = logger;
        _host = host;
        _paths = paths;
    }

    public static SportsHost? Current { get; private set; }

    /// <summary>"external" (plugin settings or ORBITAL_SPORTS_URL), "bundled", "missing" or "starting".</summary>
    public string Mode => External() is not null ? "external" : _bundledMode;

    public Uri? BaseUri => External()?.Uri ?? _supervisor?.BaseUri;

    public string Secret => External()?.Secret ?? _supervisor?.Secret ?? string.Empty;

    public ServiceSupervisor? Supervisor => _supervisor;

    /// <summary>Where the bundled service keeps its data (team choices, highlight cache, Orbital code).</summary>
    public string? DataDir { get; private set; }

    private string _bundledMode = "starting";

    /// <summary>Read on every request, so a settings change applies without restarting Jellyfin.</summary>
    private static (Uri Uri, string Secret)? External()
    {
        var config = Plugin.Instance?.Configuration;
        var url = Environment.GetEnvironmentVariable("ORBITAL_SPORTS_URL");
        if (string.IsNullOrWhiteSpace(url))
        {
            url = config?.ServiceUrl;
        }

        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return null;
        }

        var secret = Environment.GetEnvironmentVariable("ORBITAL_SPORTS_SECRET");
        return (uri, string.IsNullOrEmpty(secret) ? config?.ServiceSecret ?? string.Empty : secret);
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        Current = this;
        if (External() is { } external)
        {
            _logger.LogInformation("Orbital Sports uses the service at {Url}", external.Uri.GetLeftPart(UriPartial.Authority));
            return Task.CompletedTask;
        }

        var folder = Path.GetDirectoryName(typeof(SportsHost).Assembly.Location) ?? string.Empty;
        var exe = Path.Combine(folder, "service", OperatingSystem.IsWindows() ? "OrbitalSports.exe" : "orbital-sports");
        DataDir = Path.Combine(_paths.DataPath, "orbital-sports");
        _supervisor = new ServiceSupervisor(exe, DataDir, LocalJellyfinUrl, _logger);
        if (!_supervisor.Exists)
        {
            _bundledMode = "missing";
            _logger.LogWarning("Orbital Sports service is not installed for this system ({Exe})", exe);
            return Task.CompletedTask;
        }

        _bundledMode = "bundled";
        _supervisor.Start();
        return Task.CompletedTask;
    }

    private string LocalJellyfinUrl()
    {
        // The service checks each person's Jellyfin sign-in against this address.
        return _host.GetLocalApiUrl("127.0.0.1").TrimEnd('/');
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _supervisor?.Stop();
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        _supervisor?.Dispose();
    }
}

using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Orbital.Sports;

/// <summary>
/// /sports/api/* on Jellyfin's own address, for signed-in people only. Each request is passed to the local sports
/// service with the person's Jellyfin sign-in (which the service re-checks with Jellyfin) and the per-start secret.
/// </summary>
[ApiController]
[Route("sports/api")]
[Authorize]
public sealed partial class SportsBridgeController : ControllerBase
{
    private const int MaxRequestBytes = 16 * 1024;
    private const int MaxAddonBytes = 600 * 1024; // an add-on file (at most 256 KB) sent as JSON text
    private const int MaxResponseBytes = 8 * 1024 * 1024;
    private static readonly HttpClient Client = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        UseProxy = false,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
    })
    { Timeout = TimeSpan.FromSeconds(45) };

    private static readonly string[] AuthHeaders = ["Authorization", "X-Emby-Authorization", "X-Emby-Token", "X-MediaBrowser-Token"];

    [GeneratedRegex("^[a-z0-9][a-z0-9/_-]{0,120}$")]
    private static partial Regex SafePath();

    [HttpGet("{**path}")]
    public Task<IActionResult> Get(string path) => Forward(HttpMethod.Get, path);

    [HttpPost("{**path}")]
    public Task<IActionResult> Post(string path) => Forward(HttpMethod.Post, path);

    private async Task<IActionResult> Forward(HttpMethod method, string path)
    {
        Response.Headers.CacheControl = "no-store";
        if (string.IsNullOrEmpty(path) || !SafePath().IsMatch(path) || path.Contains("//", StringComparison.Ordinal))
        {
            return Json(404, "{\"error\":\"Not found\"}");
        }

        var host = SportsHost.Current;
        var baseUri = host?.BaseUri;
        if (host is null || baseUri is null)
        {
            Response.Headers.RetryAfter = "5";
            return Json(503, host?.Mode == "missing"
                ? "{\"error\":\"Sports is not installed for this server.\"}"
                : "{\"error\":\"Sports is starting. Retry shortly.\",\"retry_after_seconds\":5}");
        }

        using var request = new HttpRequestMessage(method, new Uri(baseUri, "/sports/api/" + path + Request.QueryString.Value));
        foreach (var name in AuthHeaders)
        {
            if (Request.Headers.TryGetValue(name, out var value))
            {
                request.Headers.TryAddWithoutValidation(name, value.ToString());
            }
        }

        request.Headers.TryAddWithoutValidation("X-Orbital-Bridge", host.Secret);
        if (method == HttpMethod.Post)
        {
            var limit = path == "catalogues/import" ? 32 * 1024 * 1024 : path == "sources/addons" ? MaxAddonBytes : MaxRequestBytes;
            if (Request.ContentLength > limit)
            {
                return Json(413, "{\"error\":\"Request too large\"}");
            }

            var input = await ReadBounded(Request.Body, limit, HttpContext.RequestAborted).ConfigureAwait(false);
            if (input is null)
            {
                return Json(413, "{\"error\":\"Request too large\"}");
            }

            request.Content = new ByteArrayContent(input);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        }

        try
        {
            using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, HttpContext.RequestAborted).ConfigureAwait(false);
            if (response.Content.Headers.ContentLength is > MaxResponseBytes)
            {
                return Json(502, "{\"error\":\"Sports response too large\"}");
            }

            using var responseStream = await response.Content.ReadAsStreamAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            var body = await ReadBounded(responseStream, MaxResponseBytes, HttpContext.RequestAborted).ConfigureAwait(false);
            if (body is null)
            {
                return Json(502, "{\"error\":\"Sports response too large\"}");
            }

            return new ContentResult { StatusCode = (int)response.StatusCode, Content = System.Text.Encoding.UTF8.GetString(body), ContentType = "application/json" };
        }
        catch (HttpRequestException)
        {
            Response.Headers.RetryAfter = "5";
            return Json(503, "{\"error\":\"Sports is restarting. Retry shortly.\",\"retry_after_seconds\":5}");
        }
        catch (TaskCanceledException) when (!HttpContext.RequestAborted.IsCancellationRequested)
        {
            return Json(504, "{\"error\":\"Sports took too long. Retry shortly.\"}");
        }
    }

    private static async Task<byte[]?> ReadBounded(Stream stream, int limit, CancellationToken cancellation)
    {
        using var output = new MemoryStream();
        var chunk = new byte[8192];
        while (true)
        {
            var read = await stream.ReadAsync(chunk.AsMemory(0, Math.Min(chunk.Length, limit + 1 - (int)output.Length)), cancellation).ConfigureAwait(false);
            if (read == 0) return output.ToArray();
            output.Write(chunk, 0, read);
            if (output.Length > limit) return null;
        }
    }

    private ContentResult Json(int status, string body) => new() { StatusCode = status, Content = body, ContentType = "application/json" };
}

/// <summary>Server status for administrators (the migration app reads it after installing the plugin).</summary>
[ApiController]
[Route("Orbital/Sports")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class SportsStatusController : ControllerBase
{
    [HttpGet("Status")]
    public IActionResult Status()
    {
        var host = SportsHost.Current;
        var supervisor = host?.Supervisor;
        return Ok(new
        {
            plugin = typeof(SportsStatusController).Assembly.GetName().Version?.ToString(),
            mode = host?.Mode ?? "not loaded",
            ready = host?.BaseUri is not null,
            pid = supervisor?.ProcessId,
            restarts = supervisor?.Restarts ?? 0,
            lastError = supervisor?.LastError,
        });
    }

    /// <summary>Saves (or clears, when empty) this server's Orbital code; the service reads it on every status check.</summary>
    [HttpPost("Code")]
    public async Task<IActionResult> SetCode()
    {
        var host = SportsHost.Current;
        if (host?.DataDir is null)
        {
            return StatusCode(503);
        }

        using var reader = new StreamReader(Request.Body);
        var buffer = new char[4097];
        var read = await reader.ReadBlockAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
        if (read > 4096)
        {
            return StatusCode(413);
        }

        var code = new string(buffer, 0, read).Trim();
        if (code.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(code, @"^FP1\.[A-Za-z0-9_-]{1,40}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$"))
        {
            return BadRequest(new { error = "That isn't a Orbital code." });
        }

        Directory.CreateDirectory(host.DataDir);
        var path = Path.Combine(host.DataDir, "orbital-code.txt");
        if (code.Length == 0)
        {
            System.IO.File.Delete(path);
        }
        else
        {
            await System.IO.File.WriteAllTextAsync(path, code).ConfigureAwait(false);
        }

        return NoContent();
    }
}

using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;

namespace Orbital.Sports;

/// <summary>
/// Orbital Sports for Jellyfin. Serves the Orbital look's sports pages (scores, Game Center, play trackers,
/// teams) on Jellyfin's own address at /sports/api/*, for signed-in people only. The data comes from a small
/// companion service that this plugin starts next to Jellyfin and keeps running; it listens on 127.0.0.1 only.
/// No video is opened, proxied or recorded. Not affiliated with or endorsed by the Jellyfin project.
/// </summary>
public sealed class Plugin : BasePlugin<PluginConfiguration>
{
    public Plugin(IApplicationPaths paths, IXmlSerializer serializer) : base(paths, serializer)
    {
        Instance = this;
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "Orbital Sports";

    public override Guid Id => new("6f1d2a3b-8c4e-4b7a-9e15-2d7c0a9b5e31");

    public override string Description => "Scores, Game Center and play trackers for the Orbital look, served on Jellyfin's own address for signed-in people.";
}

/// <summary>Plugin settings. Empty values mean "run the bundled service on this computer".</summary>
public sealed class PluginConfiguration : MediaBrowser.Model.Plugins.BasePluginConfiguration
{
    /// <summary>Use an already running sports service instead of the bundled one (for containers).</summary>
    public string ServiceUrl { get; set; } = string.Empty;

    /// <summary>Shared secret for an external service; the bundled service gets a fresh one at every start.</summary>
    public string ServiceSecret { get; set; } = string.Empty;
}

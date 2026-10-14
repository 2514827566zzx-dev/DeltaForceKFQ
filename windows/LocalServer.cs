using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.StaticFiles;
using System.Collections.Concurrent;
using System.Net;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace DeltaForceHarmonica.Windows;

/// <summary>Loopback-only protocol used by the prototype WebView.</summary>
public sealed class LocalServer
{
    private readonly WebApplication _app;
    private readonly InputSession _session;
    private readonly string _token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private readonly ConcurrentDictionary<string, Guid> _clients = new();
    public string Url { get; private set; } = "";

    private LocalServer(WebApplication app, InputSession session)
    {
        _app = app; _session = session;
    }

    public static async Task<LocalServer> StartAsync(string content, InputSession session)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = [] });
        builder.Logging.ClearProviders();
        builder.WebHost.UseKestrel(options => options.Listen(IPAddress.Loopback, 0));
        var app = builder.Build();
        var server = new LocalServer(app, session);
        app.Use(async (ctx, next) =>
        {
            var host = ctx.Request.Host;
            if (host.Host != "127.0.0.1" || host.Port != new Uri(server.Url).Port ||
                ctx.Request.Headers["Sec-Fetch-Site"] == "cross-site" ||
                ctx.Request.Headers.Origin.Count > 0 && ctx.Request.Headers.Origin != server.Url.TrimEnd('/'))
            {
                ctx.Response.StatusCode = 403;
                return;
            }
            await next();
        });
        var files = new PhysicalFileProvider(content);
        var mime = new FileExtensionContentTypeProvider();
        mime.Mappings[".mid"] = "audio/midi";
        mime.Mappings[".woff2"] = "font/woff2";
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = files, ContentTypeProvider = mime });

        app.MapGet("/api/session", () => Results.Json(new { token = server._token, platform = "Windows", state = session.Snapshot() }));
        app.MapGet("/api/state", (HttpContext ctx) => server.Authorized(ctx)
            ? Results.Json(session.Snapshot()) : Results.StatusCode(403));
        app.MapGet("/api/events", async (HttpContext ctx) =>
        {
            if (!server.Authorized(ctx)) { ctx.Response.StatusCode = 403; return; }
            var client = ctx.Request.Headers["X-Harmonica-Client"].ToString();
            if (client.Length is < 1 or > 80) { ctx.Response.StatusCode = 400; return; }
            var generation = Guid.NewGuid();
            server._clients[client] = generation;
            ctx.Response.ContentType = "application/x-ndjson";
            ctx.Response.Headers.CacheControl = "no-store";
            try
            {
                while (!ctx.RequestAborted.IsCancellationRequested)
                {
                    await ctx.Response.WriteAsync(JsonSerializer.Serialize(session.Snapshot()) + "\n", ctx.RequestAborted);
                    await ctx.Response.Body.FlushAsync(ctx.RequestAborted);
                    await Task.Delay(100, ctx.RequestAborted);
                }
            }
            catch (OperationCanceledException) { }
            catch (IOException) { }
            finally
            {
                if (server._clients.TryGetValue(client, out var latest) && latest == generation)
                {
                    server._clients.TryRemove(client, out _);
                    if (!session.WidgetVisible && session.Owner == client) session.Stop();
                }
            }
        });
        app.MapPost("/api/{action}", async (HttpContext ctx, string action) =>
        {
            if (!server.Authorized(ctx)) return Results.StatusCode(403);
            if (!ctx.Request.HasJsonContentType() || ctx.Request.ContentLength is null or > 16_777_216)
                return Results.BadRequest(new { error = "请求格式或大小无效" });
            try
            {
                var data = await ctx.Request.ReadFromJsonAsync<JsonElement>(cancellationToken: ctx.RequestAborted);
                if (data.ValueKind != JsonValueKind.Object) throw new ArgumentException("请求格式无效");
                var client = ctx.Request.Headers["X-Harmonica-Client"].ToString();
                if (client.Length is < 1 or > 80 || !server._clients.ContainsKey(client))
                    throw new ArgumentException("控制页面已断开，请刷新后重试");
                switch (action)
                {
                    case "load": session.Load(data, client); break;
                    case "play": session.Play(client); break;
                    case "pause": session.Pause(); break;
                    case "stop": if (session.Owner == client) session.Stop(); break;
                    case "seek": session.Seek(data.GetProperty("position").GetDouble()); break;
                    case "speed": session.SetSpeed(data.GetProperty("speed").GetDouble()); break;
                    default: return Results.NotFound(new { error = "不存在的操作" });
                }
                return Results.Json(session.Snapshot());
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or JsonException or KeyNotFoundException)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
        await app.StartAsync();
        server.Url = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!
            .Addresses.Single().TrimEnd('/') + "/";
        return server;
    }

    private bool Authorized(HttpContext ctx)
    {
        var input = ctx.Request.Headers["X-Harmonica-Token"].ToString();
        return input.Length == _token.Length && CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.ASCII.GetBytes(input), System.Text.Encoding.ASCII.GetBytes(_token));
    }

    public async Task StopAsync()
    {
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        await _app.StopAsync(cancel.Token);
    }
}

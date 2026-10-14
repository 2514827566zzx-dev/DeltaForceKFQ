using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace DeltaForceHarmonica.Windows;

public static class Program
{
    [STAThread]
    public static void Main()
    {
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        var host = new DesktopHost();
        app.Run(host.Main);
    }
}

public sealed class DesktopHost
{
    private readonly InputSession _session = new();
    private LocalServer? _server;
    private WidgetWindow? _widget;
    private HwndSource? _source;
    private bool _registeredPlay, _registeredStop, _registeredToggle;
    public Window Main { get; }
    public WebView2 Browser { get; } = new();
    public InputSession Session => _session;

    public DesktopHost()
    {
        Main = new Window
        {
            Title = "三角洲口风琴自动演奏器",
            Width = 612, Height = 870,
            MinWidth = 570, MinHeight = 500,
            WindowStartupLocation = WindowStartupLocation.CenterScreen,
            Background = new SolidColorBrush(Color.FromRgb(5, 6, 7)),
            Content = Browser,
        };
        Main.SourceInitialized += (_, _) => RegisterHotkeys();
        Main.Loaded += async (_, _) => await StartAsync();
        Main.Closed += (_, _) => Shutdown();
    }

    private async Task StartAsync()
    {
        try
        {
            var content = Path.Combine(AppContext.BaseDirectory, "www");
            if (!File.Exists(Path.Combine(content, "index.html")))
                throw new FileNotFoundException("曲库和界面文件不完整，请重新安装。", content);
            _server = await LocalServer.StartAsync(content, _session);
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DeltaForceHarmonica", "WebView2");
            Directory.CreateDirectory(profile);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
            await Browser.EnsureCoreWebView2Async(environment);
            Browser.CoreWebView2.WebMessageReceived += (_, args) =>
            {
                try
                {
                    using var msg = System.Text.Json.JsonDocument.Parse(args.WebMessageAsJson);
                    if (msg.RootElement.TryGetProperty("action", out var action) && action.GetString() == "minimize")
                        ShowWidget();
                }
                catch { /* An unrelated web message has no UI action. */ }
            };
            Browser.CoreWebView2.NavigationStarting += (_, args) =>
            {
                if (!args.Uri.StartsWith(_server.Url, StringComparison.OrdinalIgnoreCase)) args.Cancel = true;
            };
            Browser.Source = new Uri(_server.Url);
        }
        catch (Exception ex)
        {
            MessageBox.Show(Main, "无法启动本地演奏器：\n" + ex.Message,
                "三角洲口风琴自动演奏器", MessageBoxButton.OK, MessageBoxImage.Error);
            Main.Close();
        }
    }

    private void ShowWidget()
    {
        if (_widget is { IsVisible: true }) return;
        _session.WidgetVisible = true;
        _widget = new WidgetWindow(this);
        _widget.Show();
        _session.WidgetHandle = new WindowInteropHelper(_widget).Handle;
        Main.Hide();
    }

    public void ExpandWidget()
    {
        _session.WidgetVisible = false;
        Main.Show(); Main.Activate();
        _widget?.Close(); _widget = null;
        _session.WidgetHandle = IntPtr.Zero;
    }

    public async Task NextAsync()
    {
        if (Browser.CoreWebView2 is not null)
            await Browser.ExecuteScriptAsync("window.harmonicaDesktop?.next()");
    }

    private void RegisterHotkeys()
    {
        var handle = new WindowInteropHelper(Main).Handle;
        _session.MainHandle = handle;
        _source = HwndSource.FromHwnd(handle);
        _source?.AddHook(WndProc);
        _registeredPlay = RegisterHotKey(handle, 1, 0x4004, 0x71); // Shift+F2; no repeats
        _registeredStop = RegisterHotKey(handle, 2, 0x4004, 0x78); // Shift+F9
        _registeredToggle = RegisterHotKey(handle, 3, 0x4004, 0x70); // Shift+F1
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == 0x0312)
        {
            if (wParam.ToInt32() == 1) _session.ToggleFromHotkey();
            if (wParam.ToInt32() == 2) _session.Stop();
            if (wParam.ToInt32() == 3)
            {
                if (_widget is { IsVisible: true }) ExpandWidget(); else ShowWidget();
            }
            handled = true;
        }
        return IntPtr.Zero;
    }

    private void Shutdown()
    {
        _session.Stop();
        var handle = new WindowInteropHelper(Main).Handle;
        if (_registeredPlay) UnregisterHotKey(handle, 1);
        if (_registeredStop) UnregisterHotKey(handle, 2);
        if (_registeredToggle) UnregisterHotKey(handle, 3);
        _source?.RemoveHook(WndProc);
        _widget?.Close();
        if (_server is not null) _ = _server.StopAsync();
    }

    [DllImport("user32.dll", SetLastError = true)] private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr hwnd, int id);
}

using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace DeltaForceHarmonica.Windows;

/// <summary>The prototype's compact controls in a real topmost Windows window.</summary>
public sealed class WidgetWindow : Window
{
    private readonly DesktopHost _host;
    private readonly TextBlock _title = new();
    private readonly TextBlock _clock = new();
    private readonly Rectangle _fill = new();
    private readonly Button _play = new();
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(100) };
    private readonly Brush _dim = new SolidColorBrush(Color.FromRgb(164, 170, 177));
    private static readonly Brush Gold = new SolidColorBrush(Color.FromRgb(255, 184, 0));

    public WidgetWindow(DesktopHost host)
    {
        _host = host;
        Width = 256; Height = 100;
        Left = SystemParameters.WorkArea.Right - Width - 24;
        Top = SystemParameters.WorkArea.Top + 24;
        Topmost = true; ShowInTaskbar = false;
        WindowStyle = WindowStyle.None; AllowsTransparency = true;
        ResizeMode = ResizeMode.NoResize;
        Background = Brushes.Transparent;
        Title = "口风琴 · 悬浮挂件";
        var frame = new Border
        {
            Background = new SolidColorBrush(Color.FromArgb(235, 0, 0, 0)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(40, 255, 255, 255)),
            BorderThickness = new Thickness(1), Padding = new Thickness(12),
        };
        var content = new StackPanel(); frame.Child = content; Content = frame;
        frame.MouseLeftButtonDown += (_, args) => { if (args.OriginalSource is Border or StackPanel) DragMove(); };
        var top = new DockPanel { Height = 24 };
        var dot = new Ellipse { Width = 6, Height = 6, Fill = Gold, Margin = new Thickness(0, 9, 8, 0), VerticalAlignment = VerticalAlignment.Top };
        DockPanel.SetDock(dot, Dock.Left); top.Children.Add(dot);
        var expand = SmallButton("⤢", () => _host.ExpandWidget(), _dim);
        expand.Width = 22; DockPanel.SetDock(expand, Dock.Right); top.Children.Add(expand);
        _title.Foreground = Brushes.White; _title.FontSize = 13;
        _title.TextTrimming = TextTrimming.CharacterEllipsis; _title.VerticalAlignment = VerticalAlignment.Center;
        top.Children.Add(_title); content.Children.Add(top);

        var track = new Grid { Height = 4, Background = new SolidColorBrush(Color.FromArgb(28, 255, 255, 255)), Margin = new Thickness(0, 7, 0, 8) };
        _fill.Fill = Gold; _fill.HorizontalAlignment = HorizontalAlignment.Left;
        track.Children.Add(_fill); content.Children.Add(track);
        var bottom = new DockPanel { Height = 26 };
        _clock.Foreground = new SolidColorBrush(Color.FromArgb(105, 255, 255, 255));
        _clock.FontFamily = new FontFamily("Consolas"); _clock.FontSize = 10;
        _clock.VerticalAlignment = VerticalAlignment.Center; DockPanel.SetDock(_clock, Dock.Left);
        bottom.Children.Add(_clock);
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        _play = SmallButton("播放", () =>
        {
            if (_host.Session.State is "playing" or "countdown") _host.Session.Pause();
            else _host.Session.Play(_host.Session.Owner);
        }, Gold);
        buttons.Children.Add(_play);
        buttons.Children.Add(SmallButton("下一首", () => _ = _host.NextAsync(), _dim));
        buttons.Children.Add(SmallButton("停止", () => _host.Session.Stop(), _dim));
        DockPanel.SetDock(buttons, Dock.Right); bottom.Children.Add(buttons);
        content.Children.Add(bottom);
        _timer.Tick += (_, _) => UpdateView(track);
        Loaded += (_, _) => _timer.Start(); Closed += (_, _) => _timer.Stop();
        UpdateView(track);
    }

    private static Button SmallButton(string text, Action action, Brush color)
    {
        var button = new Button
        {
            Content = text, Foreground = color, Background = Brushes.Transparent,
            BorderThickness = new Thickness(0), FontSize = 12,
            Padding = new Thickness(4, 0, 4, 0),
            Cursor = System.Windows.Input.Cursors.Hand,
        };
        button.Click += (_, _) =>
        {
            try { action(); }
            catch (Exception ex) { MessageBox.Show(ex.Message, "演奏器"); }
        };
        return button;
    }

    private void UpdateView(Grid track)
    {
        var state = _host.Session.Snapshot();
        var type = state.GetType();
        var position = (double)type.GetProperty("position")!.GetValue(state)!;
        var duration = (double)type.GetProperty("duration")!.GetValue(state)!;
        var speed = (double)type.GetProperty("speed")!.GetValue(state)!;
        var playing = (string)type.GetProperty("state")!.GetValue(state)!;
        _title.Text = _host.Session.Title;
        _clock.Text = $"{Time(position / speed)} · {speed:0.#}×";
        _fill.Width = duration > 0 ? Math.Max(0, track.ActualWidth * position / duration) : 0;
        _play.Content = playing is "playing" or "countdown" ? "暂停" : "播放";
    }

    private static string Time(double seconds) => $"{(int)(seconds / 60)}:{(int)(seconds % 60):00}";
}

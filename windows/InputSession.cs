using DeltaHarmonica.Models;
using DeltaHarmonica.Services;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace DeltaForceHarmonica.Windows;

/// <summary>The desktop WebView and the native widget share one real SendInput worker.</summary>
public sealed class InputSession
{
    private static readonly int[] Scale = [0, 2, 4, 5, 7, 9, 11, 12];
    private const string Keys = "ZXCVBNM,";
    private readonly object _gate = new();
    private readonly PlaybackEngine _engine = new();
    private readonly System.Threading.Timer _focusTimer;
    private Song? _song;
    private string _songId = "", _title = "", _owner = "", _error = "", _target = "";
    private string _state = "idle";
    private double _duration, _position, _speed = 1;
    private long _anchor;
    private DateTime _deadline;
    private IntPtr _targetWindow;
    private int _emitted;
    private long _sequence;
    public bool WidgetVisible { get; set; }
    public IntPtr MainHandle { get; set; }
    public IntPtr WidgetHandle { get; set; }

    public InputSession()
    {
        _engine.Settings.Humanise = false;
        _engine.Settings.LeadInMs = 3000;
        _engine.StateChanged += state =>
        {
            lock (_gate)
            {
                if (state == PlaybackState.Playing)
                {
                    var foreground = GetForegroundWindow();
                    if (_targetWindow != IntPtr.Zero && foreground != _targetWindow)
                    {
                        _engine.Pause();
                        _error = "接收窗口已切换，演奏已暂停。";
                        return;
                    }
                    if (foreground == IntPtr.Zero || foreground == MainHandle || foreground == WidgetHandle)
                    {
                        _engine.Stop();
                        _state = "idle";
                        _error = "请切到接收窗口后再开始演奏。";
                        return;
                    }
                    _targetWindow = foreground;
                    _target = GetWindowTitle(foreground);
                    _anchor = Stopwatch.GetTimestamp();
                    _state = "playing";
                }
                else if (state == PlaybackState.Paused)
                {
                    _position = PositionLocked(); _state = "paused";
                }
                else if (state == PlaybackState.Idle)
                {
                    _state = "idle"; _position = 0; _targetWindow = IntPtr.Zero;
                }
            }
        };
        _engine.ProgressChanged += (_, _) => { /* The monotonic clock drives the prototype's progress bar. */ };
        _engine.NotePlayed += (_, _) => Interlocked.Increment(ref _emitted);
        _focusTimer = new System.Threading.Timer(_ =>
        {
            lock (_gate)
            {
                if (_state == "playing" && _targetWindow != IntPtr.Zero && GetForegroundWindow() != _targetWindow)
                {
                    _position = PositionLocked(); _engine.Pause();
                    _state = "paused"; _error = "接收窗口已切换，演奏已暂停。";
                }
            }
        }, null, 60, 60);
    }

    public string Owner { get { lock (_gate) return _owner; } }
    public string Title { get { lock (_gate) return _title; } }
    public string State { get { lock (_gate) return _state; } }
    public bool IsReady => true;

    private double PositionLocked() => _state == "playing"
        ? Math.Min(_duration, _position + Stopwatch.GetElapsedTime(_anchor).TotalSeconds * _speed)
        : _position;

    public object Snapshot()
    {
        lock (_gate)
            return new
            {
                sequence = ++_sequence, state = _state, position = PositionLocked(),
                duration = _duration, speed = _speed, songId = _songId, owner = _owner,
                error = _error, target = _target, ready = true,
                heldKeys = Array.Empty<string>(), heldButtons = Array.Empty<int>(),
                emittedNotes = _emitted,
                countdown = _state == "countdown" ? Math.Max(0, (_deadline - DateTime.UtcNow).TotalSeconds) : 0,
            };
    }

    public void Load(JsonElement payload, string owner)
    {
        if (!payload.TryGetProperty("score", out var score) || score.ValueKind != JsonValueKind.Object)
            throw new ArgumentException("曲谱格式无效");
        var song = CreateSong(score, payload.GetProperty("title").GetString() ?? "未命名");
        var speed = RequiredSpeed(payload.GetProperty("speed").GetDouble());
        Stop();
        lock (_gate)
        {
            _song = song; _songId = payload.GetProperty("songId").GetString() ?? "";
            _title = song.Title; _owner = owner; _duration = song.LengthSec;
            _speed = speed; _position = 0; _error = ""; _emitted = 0;
        }
    }

    public void Play(string owner, bool instant = false)
    {
        Song song;
        double? resumeFrom = null;
        lock (_gate)
        {
            if (_owner != owner || _song is null) throw new InvalidOperationException("请先选择曲目");
            if (_state is "playing" or "countdown") return;
            if (_state == "paused" && _engine.State == PlaybackState.Paused)
            {
                if (_targetWindow != IntPtr.Zero && GetForegroundWindow() == _targetWindow)
                {
                    _engine.Resume(); return;
                }
                resumeFrom = _position;
            }
        }
        if (resumeFrom.HasValue)
        {
            // A widget click changes focus. Restart from the paused position
            // with a lead-in so the user can return to the receiving window.
            _engine.Stop();
        }
        lock (_gate)
        {
            if (resumeFrom.HasValue) _position = resumeFrom.Value;
            _error = "";
            if (_position >= _duration) _position = 0;
            _song.TrimStartSec = _position;
            _song.TrimEndSec = 0;
            _targetWindow = IntPtr.Zero;
            _state = instant ? "playing" : "countdown";
            _deadline = DateTime.UtcNow.AddMilliseconds(instant ? 0 : 3000);
            _engine.Settings.Speed = _speed;
            song = _song;
        }
        if (!_engine.Play(song, instant))
        {
            lock (_gate) _state = "idle";
            throw new InvalidOperationException("此曲目没有可演奏音符");
        }
    }

    public void ToggleFromHotkey()
    {
        try
        {
            string owner;
            lock (_gate)
            {
                owner = _owner;
                if (_state is "playing" or "countdown") { Pause(); return; }
            }
            if (!string.IsNullOrEmpty(owner)) Play(owner, instant: true);
        }
        catch (Exception ex) { lock (_gate) _error = ex.Message; }
    }

    public void Pause()
    {
        lock (_gate)
        {
            if (_state == "countdown") { _engine.Stop(); _state = "paused"; return; }
            if (_state != "playing") return;
            _position = PositionLocked();
            _engine.Pause(); _state = "paused";
        }
    }

    public void Stop()
    {
        _engine.Stop();
        lock (_gate) { _state = "idle"; _position = 0; _targetWindow = IntPtr.Zero; }
    }

    public void Seek(double position)
    {
        if (!double.IsFinite(position)) throw new ArgumentException("进度无效");
        Pause();
        lock (_gate) _position = Math.Clamp(position, 0, _duration);
    }

    public void SetSpeed(double speed)
    {
        speed = RequiredSpeed(speed);
        Pause();
        double position;
        lock (_gate) position = _position;
        if (_engine.State == PlaybackState.Paused) _engine.Stop();
        lock (_gate) _position = position;
        lock (_gate) _speed = speed;
    }

    private static double RequiredSpeed(double speed)
    {
        if (speed is not (0.5 or 0.8 or 1 or 1.2 or 1.5 or 2))
            throw new ArgumentException("不支持的速度");
        return speed;
    }

    private static Song CreateSong(JsonElement score, string title)
    {
        var duration = score.GetProperty("duration").GetDouble();
        if (!double.IsFinite(duration) || duration <= 0 || duration > 3600)
            throw new ArgumentException("曲目时长无效");
        var notes = score.GetProperty("notes");
        if (notes.ValueKind != JsonValueKind.Array || notes.GetArrayLength() is < 1 or > 100000)
            throw new ArgumentException("曲谱音符数无效");
        var actions = new Dictionary<double, (NoteAction Action, int Pitch)>();
        foreach (var note in notes.EnumerateArray())
        {
            var t = note.GetProperty("time").GetDouble();
            var d = note.GetProperty("duration").GetDouble();
            var pitch = note.GetProperty("pitch").GetInt32();
            if (!double.IsFinite(t) || !double.IsFinite(d) || t < 0 || t >= duration || d <= 0 || d > 3600 || pitch is < 0 or > 127)
                throw new ArgumentException("曲谱音符无效");
            ScaleKey key; int octave; bool sharp;
            if (note.TryGetProperty("input", out var input) && input.ValueKind == JsonValueKind.Object)
            {
                var text = input.GetProperty("key").GetString();
                var index = text is { Length: 1 } ? Keys.IndexOf(text[0]) : -1;
                octave = input.GetProperty("octave").GetInt32();
                sharp = input.GetProperty("sharp").GetBoolean();
                if (index < 0 || octave is < -1 or > 1) throw new ArgumentException("TXT 键位修饰无效");
                key = (ScaleKey)index;
            }
            else (key, octave, sharp) = MapPitch(pitch);
            var action = new NoteAction { TimeSec = t, DurationSec = Math.Min(d, duration - t),
                Key = key, OctaveShift = octave, Sharp = sharp };
            if (!actions.TryGetValue(t, out var old) || pitch > old.Pitch) actions[t] = (action, pitch);
        }
        var list = actions.OrderBy(k => k.Key).Select(k => k.Value.Action).ToList();
        for (var i = 0; i < list.Count - 1; i++)
        {
            var gap = Math.Min(0.012, (list[i + 1].TimeSec - list[i].TimeSec) / 4);
            list[i].DurationSec = Math.Min(list[i].DurationSec,
                Math.Max(0.01, list[i + 1].TimeSec - list[i].TimeSec - gap));
        }
        return new Song { Title = title, SourceKind = "MIDI", Actions = list,
            LengthSec = duration, BaseMidiPitch = 60 };
    }

    private static (ScaleKey, int, bool) MapPitch(int pitch)
    {
        var folded = pitch;
        while (folded < 48) folded += 12;
        while (folded > 85) folded -= 12;
        (ScaleKey Key, int Octave, bool Sharp, int Cost)? best = null;
        foreach (var octave in new[] { 0, -1, 1 })
            for (var i = 0; i < Scale.Length; i++)
                for (var sharp = 0; sharp <= 1; sharp++)
                    if (60 + octave * 12 + Scale[i] + sharp == folded)
                    {
                        var cost = Math.Abs(octave) * 3 + sharp;
                        if (best is null || cost < best.Value.Cost)
                            best = ((ScaleKey)i, octave, sharp == 1, cost);
                    }
        if (best is null) throw new ArgumentException("音符无法映射");
        return (best.Value.Key, best.Value.Octave, best.Value.Sharp);
    }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int maxCount);
    private static string GetWindowTitle(IntPtr window)
    {
        var text = new System.Text.StringBuilder(256);
        GetWindowText(window, text, text.Capacity);
        return text.ToString();
    }
}

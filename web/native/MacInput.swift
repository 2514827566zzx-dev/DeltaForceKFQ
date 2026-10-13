import AppKit
import ApplicationServices
import CoreGraphics
import Darwin

// A small, separately identifiable native app. Only the eight harmonica keys
// and three mouse buttons are accepted; the browser never runs shell commands.
let keyCodes: [String: CGKeyCode] = ["Z": 6, "X": 7, "C": 8, "V": 9, "B": 11, "N": 45, "M": 46, ",": 43]
let marker: Int64 = 0x44464841524D
final class InputService: @unchecked Sendable {
    let lock = NSRecursiveLock()
    var keys = Set<String>()
    var buttons = Set<Int>()
    var hotkeys: [String] = []
    var target: pid_t = 0
    var targetTitle = ""
    var point = CGPoint.zero
    var armed = false
    var connected = false
    let source = CGEventSource(stateID: .privateState)
    var monitor: Any?

    func windowTitle(_ pid: pid_t) -> String {
        let application = AXUIElementCreateApplication(pid)
        var window: CFTypeRef?
        guard AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute as CFString, &window) == .success, let window else { return "" }
        var title: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window as! AXUIElement, kAXTitleAttribute as CFString, &title) == .success else { return "" }
        return title as? String ?? ""
    }
    func targetActive() -> Bool {
        guard let front = NSWorkspace.shared.frontmostApplication, front.processIdentifier == target else { return false }
        return windowTitle(target) == targetTitle
    }
    func installHotkeys() {
        DispatchQueue.main.async {
            self.lock.lock(); defer { self.lock.unlock() }
            if self.monitor != nil { return }
            self.monitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { event in
                guard !event.isARepeat, event.modifierFlags.contains(.shift), !event.modifierFlags.contains(.command), !event.modifierFlags.contains(.control), !event.modifierFlags.contains(.option) else { return }
                self.lock.lock(); defer { self.lock.unlock() }
                if event.keyCode == 101 { self.releaseAll(); self.hotkeys.append("stop") }
                if event.keyCode == 120 { self.hotkeys.append("toggle") }
            }
        }
    }

    func ready() -> Bool { AXIsProcessTrusted() && CGPreflightPostEventAccess() }
    func releaseAll() {
        lock.lock(); defer { lock.unlock() }
        for key in Array(keys) { postKey(key, false) }
        for button in buttons.sorted().reversed() { postMouse(button, false) }
        armed = false
    }
    func postKey(_ key: String, _ down: Bool) {
        guard let code = keyCodes[key], let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return }
        event.flags = []
        event.setIntegerValueField(.eventSourceUserData, value: marker)
        event.post(tap: .cghidEventTap)
        if down { keys.insert(key) } else { keys.remove(key) }
    }
    func postMouse(_ button: Int, _ down: Bool) {
        let kind: CGEventType = button == 0 ? (down ? .leftMouseDown : .leftMouseUp) : button == 2 ? (down ? .rightMouseDown : .rightMouseUp) : (down ? .otherMouseDown : .otherMouseUp)
        let cgButton: CGMouseButton = button == 0 ? .left : button == 2 ? .right : .center
        guard let event = CGEvent(mouseEventSource: source, mouseType: kind, mouseCursorPosition: point, mouseButton: cgButton) else { return }
        event.flags = []
        event.setIntegerValueField(.mouseEventClickState, value: 1)
        event.setIntegerValueField(.eventSourceUserData, value: marker)
        event.post(tap: .cghidEventTap)
        if down { buttons.insert(button) } else { buttons.remove(button) }
    }
    func handle(_ request: [String: Any]) -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        switch request["op"] as? String {
        case "status":
            if ready() { installHotkeys() }
            let actions = hotkeys; hotkeys.removeAll()
            return ["ok": true, "ready": ready(), "keys": keys.sorted(), "buttons": buttons.sorted(), "hotkeys": actions,
                    "targetActive": !armed || targetActive()]
        case "permission":
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            return ["ok": true, "ready": AXIsProcessTrustedWithOptions(options)]
        case "arm":
            guard ready() else { return ["ok": false, "error": "请在系统设置 → 隐私与安全性 → 辅助功能中允许“口风琴输入助手”，然后重试。"] }
            releaseAll()
            guard let front = NSWorkspace.shared.frontmostApplication, front.processIdentifier != getpid(), let event = CGEvent(source: nil) else {
                return ["ok": false, "error": "请先切换到接收演奏的窗口。"]
            }
            target = front.processIdentifier; targetTitle = windowTitle(target)
            guard !targetTitle.isEmpty else { return ["ok": false, "error": "无法识别接收窗口，请先点击检测页或游戏窗口。"] }
            point = event.location; armed = true
            return ["ok": true, "target": front.localizedName ?? "", "pid": target]
        case "release":
            releaseAll(); return ["ok": true]
        case "emit":
            guard ready(), armed, targetActive() else {
                releaseAll(); return ["ok": false, "error": "接收窗口已切换或输入权限不可用，演奏已停止。"]
            }
            guard let down = request["down"] as? Bool else { return ["ok": false, "error": "Invalid event"] }
            if let key = request["key"] as? String, keyCodes[key] != nil { postKey(key, down) }
            else if let button = request["button"] as? Int, (0...2).contains(button) { postMouse(button, down) }
            else { return ["ok": false, "error": "Unsupported input"] }
            return ["ok": true]
        default: return ["ok": false, "error": "Unknown operation"]
        }
    }
}

let service = InputService()
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let args = CommandLine.arguments
guard let index = args.firstIndex(of: "--socket"), args.count > index + 1 else { exit(2) }
let socketPath = args[index + 1]
guard socketPath.utf8.count < 100 else { exit(2) }
signal(SIGPIPE, SIG_IGN)
umask(0o077)
let fd = socket(AF_UNIX, SOCK_STREAM, 0)
guard fd >= 0 else { exit(3) }
var address = sockaddr_un()
address.sun_family = sa_family_t(AF_UNIX)
address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
withUnsafeMutableBytes(of: &address.sun_path) { dest in
    for (i, b) in socketPath.utf8.enumerated() { dest[i] = b }
}
let bound = withUnsafePointer(to: &address) { ptr in
    ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
}
guard bound == 0, listen(fd, 1) == 0 else { exit(4) }

// A lost server connection always releases our own held inputs and exits.
DispatchQueue.global().async {
    let client = accept(fd, nil, nil)
    guard client >= 0 else { exit(5) }
    service.lock.lock(); service.connected = true; service.lock.unlock()
    var pending = Data(), buf = [UInt8](repeating: 0, count: 4096)
    while true {
        let count = read(client, &buf, buf.count)
        if count <= 0 { break }
        pending.append(contentsOf: buf.prefix(count))
        if pending.count > 65536 { break }
        while let newline = pending.firstIndex(of: 10) {
            let line = pending.prefix(upTo: newline); pending.removeSubrange(...newline)
            let request = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] ?? [:]
            let response = service.handle(request)
            var data = (try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys])) ?? Data("{}".utf8)
            data.append(10)
            var success = true
            data.withUnsafeBytes { bytes in
                var offset = 0
                while offset < bytes.count {
                    let n = write(client, bytes.baseAddress! + offset, bytes.count - offset)
                    if n <= 0 { success = false; break }
                    offset += n
                }
            }
            if !success { service.releaseAll(); exit(0) }
        }
    }
    service.releaseAll(); close(client); close(fd); unlink(socketPath); exit(0)
}
// Do not leave an orphan waiting forever if server startup fails.
DispatchQueue.global().asyncAfter(deadline: .now() + 30) {
    service.lock.lock(); let connected = service.connected; service.lock.unlock()
    if !connected { close(fd); unlink(socketPath); exit(0) }
}
app.run()

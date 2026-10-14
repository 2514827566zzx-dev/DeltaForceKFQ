# 三角洲口风琴自动演奏器 · Windows x64 安装版

双击 `三角洲口风琴自动演奏器-安装程序-x64.exe` 安装。程序进入当前用户的 `%LOCALAPPDATA%\Programs\DeltaForceHarmonica`，并创建桌面和开始菜单快捷方式。无需预装 .NET；首次安装若缺少 Microsoft Edge WebView2 Runtime，安装器会通过随包附带的微软官方引导程序联网安装。

主界面沿用提供的黑黄原型。安装包包含全部 **663 首 MIDI**，可另外导入 MIDI 或口风琴 TXT 谱。按“开始演奏”后有三秒切换到接收窗口；发送键盘 `Z X C V B N M ,`，左键降八度、右键升八度、中键（滚轮下按）升半音。停止、暂停和窗口切换会释放输入。`Shift+F1` 切换原生置顶挂件，`Shift+F2` 播放/暂停，`Shift+F9` 停止。

应用通过本机回环地址加载随包界面与曲库。所有输入由原项目的 Windows `SendInput` 封装和演奏线程发出。选曲和收藏保存在 WebView2 用户配置目录；卸载时保留这些个人数据。

从源代码重建：在 macOS 或 Windows 上准备 .NET 10 SDK、NSIS 3 和网络，然后运行 `sh windows/build-installer.sh`。脚本编译自包含 x64 程序并输出 `windows/release/三角洲口风琴自动演奏器-安装程序-x64.exe`。可通过 `DOTNET_BIN` 与 `MAKENSIS_BIN` 指定工具路径；在 macOS 使用独立 NSIS 编译器时还需设置 `NSISDIR` 指向其资源目录。

此构建在 macOS 上交叉编译，编译器和安装包制作已通过，但**没有在 Windows 虚拟机或实体机上运行验收**。Windows 用户首次试用时应先在键鼠检测页验证映射、暂停/停止释放和置顶挂件。Windows 版本的验证结果应单独记录，不能以 Mac 上的通过结果代替。

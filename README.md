# NotShy · 不 Shy 口语

一个在本机运行的雅思口语练习与完整模拟考试应用。

## Windows 用户

在 [Releases](https://github.com/GN-shy/notshy-speaking/releases) 下载 Windows 压缩包，完整解压后双击 `NotShy.exe`。不需要安装 Python 或 Node.js。

Windows 10/11 x64；首次练习允许浏览器使用麦克风。应用在 Edge 独立窗口运行，并在通知区域提供打开和退出菜单。

## Shy 十天冲刺

首页或侧栏点击“Shy 十天冲刺”：每天 4 个完整 Part 1 主题、6 张 Part 2 题卡及各自全部 Part 3 原题。先问完 4 个主题，再逐张题卡练 Part 2/3。全程手动、不限时，不加开场或额外追问。

首次开始当天为第 1 天，之后按日期推进，最多 10 天。每天只组一份任务；保存后能继续未完成的小题，全部完成显示“今日任务完成”。优先单题未练的主题，题库轮完后优先练习较少、较久未练的主题。已完成的小题同步题库的“单题已练”，不改变整套模拟统计。不保存会撤销当次进度并保留当天原题。

## 功能

- 自选题库练习，以及从开场到 Part 3 的完整模拟。
- 模拟可选手动下一题或官方计时；计时模式在录音下按停顿接题，长答与阶段超时强制打断。
- Part 1 每个抽中话题按原顺序问全部问题（官方计时仍受阶段上限限制）；Part 2 准备 1 分钟、陈述最多 2 分钟；Part 3 与题卡配对。
- 完整计时模拟 11–14 分钟；各阶段不突破相应时间上限。
- 逐题英文字幕、本机朗读、录音回放、可选英文转写、Part 2 笔记。
- 单题练习、整套抽到和整套完成分别统计；下次组卷优先轮换未练、未抽到的题。
- 提前结束时选择保存、不保存或继续；不保存会撤销本场数据与进度。

这是规则考官与语音活动检测工具，不提供自动雅思评分。内置资料来自用户提供的备考题库，不是 IELTS 官方发布的试题。语音识别是否可用取决于浏览器和网络；录音、计时和字幕可独立运行。

## 数据

便携 EXE 将数据写入旁边的 `NotShyData/`；源码版使用 `data/`。若便携目录不可写，会回退到 `%LOCALAPPDATA%/NotShy/data/`。

仓库与发布包不包含个人练习记录、录音、缓存、备份或账号凭据。JSON 导出仅含文字记录；完整备份需保存整个数据目录。英文转写默认关闭，开启后可能使用浏览器厂商的在线识别服务。

## 从源码运行

Python 3.10 或更高版本即可运行服务本身：

```powershell
python server.py --open
```

默认源码端口为 `8765`，便携 EXE 默认端口为 `8767`。两者均只监听 `127.0.0.1`。可用 `--port` 与 `--data-dir` 指定隔离的实例。

## 打包 Windows EXE

```powershell
python -m venv .build-venv
.\.build-venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\.build-venv\Scripts\python.exe tools\build_windows.py
```

打包结果位于 `release/NotShy-1.4.0-Windows-x64.zip`。EXE 自带 Python 运行时、界面和题库。收件人不需要源码目录或开发环境。实际运行仍需 Windows 与支持麦克风的浏览器。

## 检查

```powershell
node --test tests/engine.test.js tests/turns.test.js tests/sprint.test.js
python -m unittest discover -s tests -p test_server.py -v
```

浏览器验证使用 Playwright 和本机 Chrome/Edge，需要先启动隔离服务：

```powershell
python server.py --port 8766 --data-dir test-results/browser-data
```

然后运行 `tests/browser.cjs`、`tests/modes.cjs`、`tests/speech-browser.cjs` 或 `tests/progress-browser.cjs`。首次可用 `npm install` 安装浏览器测试依赖。

详见 [使用说明](使用说明.md)。

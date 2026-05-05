# PostScript 扩展使用指南

本文档面向 PostScript VSCode 扩展的最终用户，提供完整的使用说明与操作指南。

---

## 📋 目录
- [安装扩展](#安装扩展)
- [语法高亮](#语法高亮)
- [代码大纲](#代码大纲)
- [代码片段](#代码片段)
- [调试运行 PostScript](#调试运行-postscript)
- [扩展配置](#扩展配置)
- [常见问题](#常见问题)
- [故障排除](#故障排除)

---

## 🔧 安装扩展

### 方式 1: VSCode 市场安装
1. 打开 VSCode
2. 点击左侧扩展面板 (Ctrl+Shift+X)
3. 搜索 `PostScript Programming Language`
4. 点击安装按钮

### 方式 2: 本地安装
1. 下载 `.vsix` 扩展包
2. 在扩展面板点击右上角菜单
3. 选择 `从 VSIX 安装...`
4. 选择下载的扩展包文件

---

## ✨ 语法高亮

安装后自动为以下文件启用 PostScript 语法高亮:
- `.ps` - PostScript 源文件
- `.eps` - Encapsulated PostScript 文件

语法高亮特性:
- ✅ 运算符关键字高亮
- ✅ 字符串、数字、注释完整识别
- ✅ 字典、数组、过程嵌套语法高亮
- ✅ Ghostscript 扩展操作符支持

---

## 📑 代码大纲 (文档符号)

本扩展内置 PostScript 语言服务器，为您的代码提供结构化大纲视图:

### 支持的符号类型:
| 符号类型 | 图标 | 说明 |
|---------|------|------|
| 数组 | 📦 | PostScript 数组定义 |
| 字典 | 📘 | 字典与键值对 |
| 过程 | ƒ | 过程定义 (可执行数组) |
| 字符串 | 📝 | 字符串常量 |
| 名称 | 🏷️ | 命名定义 |
| 数字 | 🔢 | 数值常量 |

### 使用方法:
1. 打开 PostScript 文件
2. 点击左侧「大纲」面板
3. 点击任意符号直接跳转到对应代码位置
4. 大纲支持折叠展开层级结构

---

## 📝 代码片段

扩展包含超过 300+ PostScript 标准运算符代码片段:

### 分类:
- 🔢 堆栈操作与算术运算
- 📚 字典与数组操作
- 📜 字符串处理
- 🎮 流程控制
- 🖼️ 图形绘制
- 🔤 字体操作
- ⚙️ 虚拟内存管理
- 🐛 调试与错误处理

### 使用方法:
1. 在 PostScript 文件中输入运算符前缀
2. 按 `Ctrl+Space` 触发自动补全
3. 使用上下箭头选择需要的片段
4. 按 `Tab` 插入代码，继续按 `Tab` 在占位符间跳转

---

## 🐞 调试运行 PostScript

本扩展提供完整的 Ghostscript 调试集成:

### 前置要求
✅ Ghostscript 已安装并在系统 PATH 中
> 下载地址: https://ghostscript.com/releases/gsdnld.html

### 快速调试步骤:
1. 打开需要运行的 `.ps` 文件
2. 点击左侧「运行和调试」面板 (Ctrl+Shift+D)
3. 点击「创建 launch.json 文件」
4. 选择「PostScript (Ghostscript) Debugger」
5. 按 F5 开始调试

### 调试功能:
| 功能 | 快捷键 | 说明 |
|------|--------|------|
| 断点 | F9 | 在代码行设置断点 |
| 继续 | F5 | 运行到下一个断点 |
| 单步跳过 | F10 | 执行下一条语句 |
| 停止调试 | Shift+F5 | 终止当前调试 |

### 调试输出
所有 Ghostscript stdout/stderr 输出将显示在「调试控制台」面板中。

---

## ⚙️ 扩展配置

### 全局设置
打开设置 (Ctrl+,) 搜索 `postscript` 可配置以下选项:

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `postscript.interpreter.executable` | 自动检测 | Ghostscript 可执行文件路径 |

### Ghostscript 自动检测顺序
扩展会自动按以下优先级查找 Ghostscript:
1. `launch.json` 中配置的 `ghostscriptPath`
2. VSCode 全局设置中的可执行路径
3. 系统 PATH 自动检测:
   - **Windows**: `gswin64c` → `gswin32c` → `gs`
   - **macOS/Linux**: `gs`

---

## ❓ 常见问题

**Q: 为什么大纲视图不显示内容?**
> 大纲视图需要 PostScript 是纯文本格式。包含二进制数据的 EPS 文件或嵌入图像的 PostScript 文件无法解析。语法高亮仍可正常工作。

**Q: 调试时提示找不到 Ghostscript?**
> 请确认 Ghostscript 已正确安装，或在设置中手动指定可执行文件完整路径。

**Q: 设置断点后调试不停下来?**
> 请确保断点设置在可执行代码行，注释和空行不支持断点。

**Q: 可以调试压缩的 PostScript 文件吗?**
> 支持标准 PostScript 代码，经过极度压缩或混淆的代码可能无法正确识别行位置。

---

## 🆘 故障排除

### 调试启动失败
1. 检查 Ghostscript 是否可以从命令行正常运行
2. 尝试在设置中手动指定 Ghostscript 完整路径
3. 查看 VSCode 「开发人员工具」控制台的错误信息

### 语法高亮不工作
1. 确认文件后缀为 `.ps` 或 `.eps`
2. 右下角语言模式选择为 PostScript
3. 尝试重新加载 VSCode 窗口

---

🔗 英文文档: [USAGE_GUIDE.md](USAGE_GUIDE.md)

如果您遇到其他问题，欢迎在 GitHub 仓库提交 Issue。
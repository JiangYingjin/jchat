# JChat: The Super Terminal for Advanced AI Interaction & Workflow Automation

[中文](./README_zh.md)

[<img src="https://img.shields.io/badge/Visit%20JChat-Live%20Demo-blue?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxZW0iIGhlaWdodD0iMWVtIiB2aWV3Qm94PSIwIDAgMjQgMjQiPjxwYXRoIGZpbGw9ImN1cnJlbnRDb2xvciIgZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEycy00LjQ4IDEwIDEwIDEwczEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyWk04LjUgMTYuNUw0IDEybDEuNDE1LTEuNDE1TDguNSAxMy42NTVsNy4wODUtNy4wODVMMTcgOC41TDguNSAxNi41WiIvPjwvc3ZnPg==">](https://chat.jyj.cx)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**JChat is more than just a chat application—it's a powerful AI super terminal designed for developers, researchers, and power users. It elevates your interaction with Large Language Models (LLMs) to a new level of productivity by offering unparalleled long-context capabilities, an innovative group session workflow engine, and 100% local data storage.**

Visit the live demo at: **https://chat.jyj.cx**

---

## ✨ Key Features

| Feature | Description |
| :--- | :--- |
| 🚀 **Unparalleled Context-Handling** | Built-in **Monaco Editor** (from VS Code), deeply optimized for million-token contexts. Effortlessly analyze entire codebases or read lengthy documents. |
| 🤖 **Workflow Automation Engine** | Innovative **"Group Session"** feature to batch-create sessions from files and "batch-apply" commands, turning your AI into a dedicated work team. |
| 🛡️ **100% Local-First** | All data is stored in your browser's **IndexedDB**, ensuring maximum speed, offline access, and absolute data privacy. |
| 💬 **Advanced Dialogue Management** | **Branch** conversations from any point, **edit any message** in the history, and safely **delete with undo** for unprecedented flexibility. |
| 🎨 **Rich Content Support** | Render **LaTeX** equations, **Mermaid** diagrams, and full **GitHub Flavored Markdown** directly in your chats. |
| 📦 **Robust Backup System** | A full-featured, version-aware **import/export** system ensures your valuable data is never lost. |

## 🤔 Why JChat?

Current AI chat tools often fall short when you try to tackle complex tasks, leading to common bottlenecks:

-   **Context Length Anxiety**: Want an AI to analyze a codebase or a long report? Sorry, you've hit the context limit. You're forced to manually split and feed data, a frustrating and painful process.
-   **The Nightmare of Batch Tasks**: Need to apply the same pattern to 20 different files? You're stuck performing the same manual operation 20 times, which is incredibly inefficient.
-   **Chaotic Conversation Management**: Dozens of chats get jumbled together, making them difficult to organize and review. Exploring different branches of a single problem means opening new chats, leading to a cluttered mess.
-   **Data Privacy Concerns**: All your conversation data is stored on the cloud, posing a risk of privacy leaks.

**JChat was born to solve these problems.** It refuses to be a mere "toy" and strives to be a true **AI Productivity Engine**. By combining a powerful editor, an innovative workflow, and a local-first architecture, JChat empowers you to truly harness AI to accomplish complex tasks that were previously unimaginable.

## ⚙️ In-Depth Features

### 1. An Editor Built for Ultra-Long Context

Most AI tools' system prompt inputs become incredibly difficult to use, or even crash the browser, when faced with tens of thousands of tokens.

JChat solves this fundamentally. We have creatively integrated the powerful **Monaco Editor** (the core of VS Code) seamlessly into the system prompt editing workflow. This means you can easily and smoothly edit and manage contexts of up to a million tokens, just like in a professional IDE.

- **Say Goodbye to Lag and Crashes**: No matter how long your context is, Monaco Editor's virtualization technology ensures extreme performance and a smooth editing experience.
- **A Convenient Editing Experience**: Enjoy multi-cursor support, syntax highlighting (coming soon), search-and-replace, and all the familiar IDE features.
- **Real-time Token Count**: The bottom-right corner of the editor displays a real-time token count of the current context, helping you precisely control costs and input.
- **Intelligent Model Switching**: Based on the length of your context, JChat will intelligently recommend and switch to an AI model that supports that length.

> Leave behind the anxiety of editing prompts in a tiny input box. In JChat, context management is finally a pleasure.

### 2. A Powerful Group Session & Workflow Engine

JChat introduces the innovative "Group Session" feature, upgrading the traditional, linear chat model to an organizable, batch-operable **workflow model**.

- **Batch-Create Sessions**: Drag and drop multiple files (code, documents, logs, etc.) from your local machine, and JChat will automatically create a session group for you, with each file becoming a separate session containing its content.
- **Batch-Apply Commands**: You can "batch-apply" the same command to all sessions within a group. JChat will automatically execute these tasks in the background and notify you upon completion. This exponentially increases your efficiency for scenarios like batch refactoring, translation, or summarization.
- **Clear Organization & Navigation**: All groups and their sessions are displayed in a clear, tree-like structure that supports drag-and-drop sorting, allowing you to easily manage dozens or even hundreds of conversations.
- **Status Tracking**: Each group and session has a clear status indicator (normal, pending, error), giving you an at-a-glance overview of all your tasks.

> Imagine giving a single command: "Refactor these components using TypeScript," and JChat automatically processes all the JS files in the group. This is the workflow revolution that JChat brings.

### 3. Advanced Dialogue Management

JChat provides a suite of sophisticated tools to manage your conversations like you manage your code.

- **Branching**: No more starting a new chat just to explore a new idea. You can create a "branch" from any point in the conversation history to freely explore different paths while keeping the main conversation clean.
- **Edit Any Message**: Whether it's your input or the AI's response, you can go back and edit any message at any time, then continue the conversation from that point, providing immense flexibility for debugging and refining prompts.
- **Safe Deletion with Undo**: Accidentally deleted the wrong message, session, or even an entire group? No worries. JChat features a delayed deletion with an "Undo" option, giving you plenty of time to change your mind.

### 4. Local-First Architecture & Data Security

JChat's design philosophy puts user data sovereignty first.

- **100% Local Storage**: All your data, from the session list to every single message, is stored in your own computer's browser (IndexedDB). This means:
    - **Extreme Speed**: No waiting for network requests; operations are silky smooth.
    - **Offline Access**: You can review and organize your conversation history anytime, even without an internet connection.
    - **Absolute Privacy**: Your data is never uploaded to any third-party server, completely eliminating the risk of privacy leaks.
- **Complete Backup & Restore**: A single click exports a JSON file containing all your data, which can be used to perfectly restore your workspace on a new device, making data migration effortless.

### 5. Rich Content Support & Data Export

JChat believes that technical communication should not be limited to plain text.

- **Rich Text & Images**: Full support for GFM (GitHub Flavored Markdown), allowing you to easily use tables, lists, code blocks, and more. It also supports mixed text and images, with uploaded images displayed directly in the conversation.
- **Mathematical Formulas**: A built-in KaTeX rendering engine perfectly displays complex LaTeX mathematical formulas.
- **Diagrams & Charts**: A built-in Mermaid rendering engine allows you to generate flowcharts, sequence diagrams, Gantt charts, and more, directly in the chat using simple text descriptions.
- **One-Click Export to Image**: Any part of a conversation can be exported as a beautiful image, perfect for sharing on social media.

## 🚀 Getting Started

1.  **Clone the repository**
    ```bash
    git clone https://github.com/JinnLock/JChat.git
    cd JChat
    ```

2.  **Install dependencies**
    Using `yarn` is recommended:
    ```bash
    yarn install
    ```

3.  **Configure Environment Variables**
    Create a file named `.env.local` in the project root and add your configuration.

    ```dotenv
    # .env.local

    # [Required] OpenAI API Key
    # Get yours from https://platform.openai.com/account/api-keys
    API_KEY="sk-..."

    # [Optional] Access Code
    # Restrict access with a password. Use commas for multiple codes.
    CODE="your_access_code_1,your_access_code_2"

    # [Optional] OpenAI API Proxy Endpoint
    # Use this if you cannot access the OpenAI API directly.
    # e.g., https://api.openai.com
    BASE_URL=""

    # [Optional] Specify Available Models
    # Override the default model list. Use commas for multiple models.
    # e.g., gpt-4,gpt-4-32k,gpt-3.5-turbo
    MODELS=""

    # [Optional] SOCKS or HTTP Proxy
    # For server-side requests to bypass network restrictions.
    # e.g., socks5://127.0.0.1:1080
    PROXY_URL=""
    ```

4.  **Start the development server**
    ```bash
    yarn dev
    ```

    The application will be running at `http://localhost:3000`.

## 🛠️ Tech Stack

-   **Framework**: [Next.js](https://nextjs.org/) 15 (App Router)
-   **State Management**: [Zustand](https://github.com/pmndrs/zustand)
-   **UI**: [React](https://react.dev/)
-   **Local Storage**: [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (via `localforage`)
-   **Code Editor**: [Monaco Editor](https://microsoft.github.io/monaco-editor/)
-   **Markdown/LaTeX**: [react-markdown](https://github.com/remarkjs/react-markdown) with `remark-gfm`, `rehype-katex`
-   **Diagrams**: [Mermaid](https://mermaid.js.org/)
-   **Drag & Drop**: [@dnd-kit](https://dndkit.com/)

## 🤝 Contributing

We welcome and encourage community contributions! If you have any ideas, suggestions, or have found a bug, please feel free to open an Issue or submit a Pull Request.

## 📄 License

This project is open-source under the [MIT License](LICENSE).

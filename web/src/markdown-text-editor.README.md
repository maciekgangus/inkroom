# Markdown Text Editor - Enhanced Text Input Feature

## Overview

This component provides an enhanced text input experience for the Inkroom whiteboard with simplified Markdown support. It wraps the existing `TextEditor` component and adds:

- **Markdown formatting toolbar** with buttons for common formatting
- **Keyboard shortcuts** for quick formatting
- **Help popup** with Markdown syntax reference
- **Simplified Markdown support** without images (as requested)

## Features

### Supported Markdown Syntax

- **Bold**: `**text**` → **text**
- _Italic_: `*text*` → _text_
- ~~Strikethrough~~: `~~text~~` → ~~text~~
- `Code`: `` `text` `` → `text`
- Headers: `# Header 1`, `## Header 2`
- Lists: `- item`, `1. item`
- Horizontal rule: `---`
- Links: `[text](https://example.com)`

### Keyboard Shortcuts

- **Ctrl/Cmd + B**: Wrap selection with `**` for bold
- **Ctrl/Cmd + I**: Wrap selection with `*` for italic
- **Ctrl/Cmd + D**: Wrap selection with `~~` for strikethrough
- **Ctrl/Cmd + E**: Wrap selection with `` ` `` for code
- **Tab**: Insert list item (`- `) at cursor position

### UI Elements

1. **Toolbar**: Appears above the text editor with formatting buttons
2. **Help Button**: Question mark button next to the editor, shows/hides help popup
3. **Help Popup**: Displays Markdown syntax reference
4. **Text Editor**: The underlying textarea with all existing functionality

## Usage

```tsx
import { MarkdownTextEditor } from "./markdown-text-editor";

<MarkdownTextEditor
	x={120}
	y={80}
	fontSize={30}
	color="#d32f2f"
	width={300}
	minHeight={90}
	onCommit={(text) => {
		// Handle committed text with markdown
		console.log(text);
	}}
	onCancel={() => {
		// Handle cancel
	}}
	showHelpInitially={false} // Optional: show help on mount
/>;
```

## Props

| Prop              | Type                   | Required | Description                        |
| ----------------- | ---------------------- | -------- | ---------------------------------- |
| x                 | number                 | Yes      | Screen X position of editor        |
| y                 | number                 | Yes      | Screen Y position of editor        |
| fontSize          | number                 | Yes      | Font size in pixels                |
| color             | string                 | Yes      | Text color                         |
| width             | number                 | No       | Width for area mode (R-044)        |
| minHeight         | number                 | No       | Minimum height for area mode       |
| onResize          | () => void             | No       | Called when field size changes     |
| initialText       | string                 | No       | Initial text when editing existing |
| onCommit          | (text: string) => void | Yes      | Called when text is committed      |
| onCancel          | () => void             | Yes      | Called when editing is cancelled   |
| showHelpInitially | boolean                | No       | Show help popup on mount           |

## Implementation Notes

### Styling

The component uses the existing design tokens from the application:

- `--bg`, `--surface`, `--border`, `--text`, `--muted`, `--accent`, etc.
- `--radius`, `--radius-lg` for border radius
- `--shadow` for box shadows

The toolbar and help popup use a semi-transparent background with backdrop blur for a modern, integrated look.

### Behavior

- The component preserves all existing `TextEditor` behavior
- Formatting buttons wrap selected text or insert tags at cursor
- Keyboard shortcuts work with both Ctrl (Windows) and Cmd (Mac)
- Help popup is positioned intelligently based on viewport space
- Clicking outside the help popup closes it

### Compatibility

- Works in both point mode and area mode (R-044)
- Respects existing text editor behavior for Enter, Escape, and blur events
- Maintains focus on the textarea after formatting

## Testing

The component includes comprehensive tests covering:

- Rendering with correct position and size
- Toolbar button functionality
- Keyboard shortcuts
- Text formatting
- Initial text handling
- Area mode behavior

Run tests with:

```bash
npm test -- markdown-text-editor.test.tsx
```

## Design Decisions

1. **No Images**: As requested, image support is intentionally omitted
2. **Simplified Markdown**: Only the most commonly used formatting is supported
3. **Intuitive UI**: Toolbar appears above editor, help is easily accessible
4. **Keyboard-First**: All formatting is available via keyboard shortcuts
5. **Non-Intrusive**: Help is opt-in via button click
6. **Consistent Styling**: Uses existing design system tokens

## Future Enhancements

Possible future improvements:

- Add more Markdown features (tables, blockquotes, etc.)
- Syntax highlighting for code blocks
- Live preview of formatted text
- Customizable toolbar buttons
- Remember help visibility preference

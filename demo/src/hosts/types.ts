import type { Editor } from '@tiptap/core';
import type { EditorFeature, EditorMode, EditorUploadHandler } from 'track-changes-core';

export type Framework = 'vanilla' | 'vue' | 'react';

export interface HostOptions {
  /** Initial document (HTML). */
  content: string;
  mode: EditorMode;
  authorId: string;
  features: EditorFeature[];
  uploadHandler: EditorUploadHandler;
  maxWords: number;
  /** Called with the Tiptap editor each time the adapter (re)creates it. */
  onReady: (editor: Editor) => void;
  onChange: () => void;
}

/**
 * What the demo shell needs from each framework's editor. Review actions and
 * HTML output go through the Tiptap editor via the shared core, so a host
 * only has to mount the adapter and forward the two live props.
 */
export interface EditorHost {
  setMode: (mode: EditorMode) => void;
  setAuthor: (authorId: string) => void;
  destroy: () => void;
}

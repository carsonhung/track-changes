import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/vue-3';
import { trackableNode } from '@tdg-reports/track-changes-core';
import type { EditorFeature } from './types';
import { featureInsertNode, featureDeleteNode } from './featureCommands';

/**
 * Table feature (CKEditor `Table`-equivalent, demo-grade): minimal table /
 * row / cell nodes — row and cell are wrapped with the core's `trackableNode()`
 * so structural changes carry the `suggestion` node attribute — plus toolbar
 * items for insert-table / add-row / delete-row that go through the suggestion
 * commands when suggesting. No column ops, resizing, or prosemirror-tables
 * editing; swap the node set for prosemirror-tables when a real schema needs it.
 */

export const TrackedTable = Node.create({
  name: 'table',
  group: 'block',
  content: 'tableRow+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'table' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['table', mergeAttributes({ class: 'tc-table' }, HTMLAttributes), ['tbody', 0]];
  },
});

export const TrackedTableRow = trackableNode(
  Node.create({
    name: 'tableRow',
    content: 'tableCell+',
    parseHTML() {
      return [{ tag: 'tr' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['tr', mergeAttributes(HTMLAttributes), 0];
    },
  }),
);

export const TrackedTableCell = trackableNode(
  Node.create({
    name: 'tableCell',
    content: 'inline*',
    parseHTML() {
      return [{ tag: 'td' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['td', mergeAttributes(HTMLAttributes), 0];
    },
  }),
);

/** Depth of the tableRow ancestor at the selection head, or 0 when outside a table. */
function rowDepth(editor: Editor): number {
  const $from = editor.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'tableRow') return d;
  }
  return 0;
}

export interface TableFeatureLabels {
  insertTable: string;
  addRow: string;
  deleteRow: string;
}

export interface TableFeatureOptions {
  /** Override button labels (i18n). */
  labels?: Partial<TableFeatureLabels>;
  /** Dimensions of a freshly inserted table. */
  rows?: number;
  cols?: number;
}

export function createTableFeature(options: TableFeatureOptions = {}): EditorFeature {
  const labels: TableFeatureLabels = {
    insertTable: 'Insert table',
    addRow: 'Add row',
    deleteRow: 'Delete row',
    ...options.labels,
  };
  const rows = options.rows ?? 2;
  const cols = options.cols ?? 2;

  return {
    name: 'table',
    extensions: () => [TrackedTable, TrackedTableRow, TrackedTableCell],
    toolbarItems: () => [
      {
        id: 'table.insert',
        label: labels.insertTable,
        text: labels.insertTable,
        isEnabled: ({ editor }) => rowDepth(editor) === 0,
        run: ({ editor }) => {
          const schema = editor.state.schema;
          const cell = () => schema.nodes.tableCell.create(null);
          const row = () => schema.nodes.tableRow.create(null, Array.from({ length: cols }, cell));
          const table = schema.nodes.table.create(null, Array.from({ length: rows }, row));
          const $from = editor.state.selection.$from;
          const at = $from.depth > 0 ? $from.after(1) : editor.state.selection.from;
          featureInsertNode(editor, table, at);
        },
      },
      {
        id: 'table.addRow',
        label: labels.addRow,
        text: labels.addRow,
        isEnabled: ({ editor }) => rowDepth(editor) > 0,
        run: ({ editor }) => {
          const depth = rowDepth(editor);
          if (!depth) return;
          const $from = editor.state.selection.$from;
          const current = $from.node(depth);
          const schema = editor.state.schema;
          const newRow = schema.nodes.tableRow.create(
            null,
            Array.from({ length: current.childCount }, () => schema.nodes.tableCell.create(null)),
          );
          featureInsertNode(editor, newRow, $from.after(depth));
        },
      },
      {
        id: 'table.deleteRow',
        label: labels.deleteRow,
        text: labels.deleteRow,
        // Keep at least one row so the table stays schema-valid even when the
        // deletion resolves to a real removal (own un-accepted insertion).
        isEnabled: ({ editor }) => {
          const depth = rowDepth(editor);
          return depth > 0 && editor.state.selection.$from.node(depth - 1).childCount > 1;
        },
        run: ({ editor }) => {
          const depth = rowDepth(editor);
          if (!depth) return;
          featureDeleteNode(editor, editor.state.selection.$from.before(depth));
        },
      },
    ],
  };
}

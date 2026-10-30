import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/vue-3';
import type { Node as PMNode } from '@tiptap/pm/model';
import { trackableNode } from '@carsonhung/track-changes-core';
import type { EditorFeature } from './types';
import {
  featureInsertNode,
  featureDeleteNode,
  featureInsertNodes,
  featureDeleteNodes,
} from './featureCommands';

/**
 * Table feature (CKEditor `Table`-equivalent): minimal table / row / cell /
 * header-cell nodes — row and cells are wrapped with the core's
 * `trackableNode()` so structural changes carry the `suggestion` node
 * attribute — plus toolbar items for insert-table / add-row / delete-row /
 * add-column / delete-column. Row ops are tracked per row; column ops are
 * tracked as ONE grouped suggestion across all rows (shared id via
 * `suggestInsertNodes` / `suggestDeleteNodes`), so accepting or rejecting a
 * column is a single decision. New tables get a `<th>` header row by default
 * (`withHeaderRow`). No cell merging or resizing; swap the node set for
 * prosemirror-tables when a real schema needs those.
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
    content: '(tableCell | tableHeader)+',
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

export const TrackedTableHeaderCell = trackableNode(
  Node.create({
    name: 'tableHeader',
    content: 'inline*',
    parseHTML() {
      return [{ tag: 'th' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['th', mergeAttributes(HTMLAttributes), 0];
    },
  }),
);

const CELL_TYPES = ['tableCell', 'tableHeader'];

/** Depth of the tableRow ancestor at the selection head, or 0 when outside a table. */
function rowDepth(editor: Editor): number {
  const $from = editor.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'tableRow') return d;
  }
  return 0;
}

interface ColumnContext {
  /** The table node and the position of its first child (row). */
  table: PMNode;
  tableStart: number;
  /** Index of the column the selection sits in. */
  colIndex: number;
}

/** Resolve the table + column index at the selection, or null when outside. */
function columnContext(editor: Editor): ColumnContext | null {
  const depth = rowDepth(editor);
  if (!depth) return null;
  const $from = editor.state.selection.$from;
  return {
    table: $from.node(depth - 1),
    tableStart: $from.start(depth - 1),
    colIndex: $from.index(depth),
  };
}

/**
 * Per row: the position of the cell at `colIndex` (for deletes) and the
 * position right after it (for inserts). Rows shorter than `colIndex` clamp
 * to their last cell, keeping ragged tables (mid-edit states) safe.
 */
function columnCells(ctx: ColumnContext): Array<{ row: PMNode; cellPos: number; cell: PMNode }> {
  const out: Array<{ row: PMNode; cellPos: number; cell: PMNode }> = [];
  let rowPos = ctx.tableStart;
  for (let r = 0; r < ctx.table.childCount; r++) {
    const row = ctx.table.child(r);
    const idx = Math.min(ctx.colIndex, row.childCount - 1);
    let cellPos = rowPos + 1;
    for (let i = 0; i < idx; i++) cellPos += row.child(i).nodeSize;
    out.push({ row, cellPos, cell: row.child(idx) });
    rowPos += row.nodeSize;
  }
  return out;
}

export interface TableFeatureLabels {
  insertTable: string;
  addRow: string;
  deleteRow: string;
  addColumn: string;
  deleteColumn: string;
}

export interface TableFeatureOptions {
  /** Override button labels (i18n). */
  labels?: Partial<TableFeatureLabels>;
  /** Dimensions of a freshly inserted table. */
  rows?: number;
  cols?: number;
  /** Insert new tables with a `<th>` header row (default true). */
  withHeaderRow?: boolean;
}

export function createTableFeature(options: TableFeatureOptions = {}): EditorFeature {
  const labels: TableFeatureLabels = {
    insertTable: 'Insert table',
    addRow: 'Add row',
    deleteRow: 'Delete row',
    addColumn: 'Add column',
    deleteColumn: 'Delete column',
    ...options.labels,
  };
  const rows = options.rows ?? 2;
  const cols = options.cols ?? 2;
  const withHeaderRow = options.withHeaderRow ?? true;

  return {
    name: 'table',
    extensions: () => [TrackedTable, TrackedTableRow, TrackedTableCell, TrackedTableHeaderCell],
    toolbarItems: () => [
      {
        id: 'table.insert',
        label: labels.insertTable,
        text: labels.insertTable,
        isEnabled: ({ editor }) => rowDepth(editor) === 0,
        run: ({ editor }) => {
          const schema = editor.state.schema;
          const cell = () => schema.nodes.tableCell.create(null);
          const headerCell = () => schema.nodes.tableHeader.create(null);
          const row = (header: boolean) =>
            schema.nodes.tableRow.create(
              null,
              Array.from({ length: cols }, header ? headerCell : cell),
            );
          const table = schema.nodes.table.create(
            null,
            Array.from({ length: rows }, (_, r) => row(withHeaderRow && r === 0)),
          );
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
      {
        id: 'table.addColumn',
        label: labels.addColumn,
        text: labels.addColumn,
        isEnabled: ({ editor }) => rowDepth(editor) > 0,
        run: ({ editor }) => {
          const ctx = columnContext(editor);
          if (!ctx) return;
          const schema = editor.state.schema;
          // New cell matches each row's cell type at the column (th in a
          // header row, td elsewhere); inserted after the current column.
          const inserts = columnCells(ctx).map(({ cellPos, cell }) => ({
            node: (CELL_TYPES.includes(cell.type.name)
              ? cell.type
              : schema.nodes.tableCell
            ).create(null),
            at: cellPos + cell.nodeSize,
          }));
          featureInsertNodes(editor, inserts);
        },
      },
      {
        id: 'table.deleteColumn',
        label: labels.deleteColumn,
        text: labels.deleteColumn,
        // Keep at least one column per row so rows stay schema-valid.
        isEnabled: ({ editor }) => {
          const ctx = columnContext(editor);
          if (!ctx) return false;
          for (let r = 0; r < ctx.table.childCount; r++) {
            if (ctx.table.child(r).childCount <= 1) return false;
          }
          return true;
        },
        run: ({ editor }) => {
          const ctx = columnContext(editor);
          if (!ctx) return;
          featureDeleteNodes(
            editor,
            columnCells(ctx).map(({ cellPos }) => cellPos),
          );
        },
      },
    ],
  };
}

// Snapshot undo/redo. Every model change goes through transact() (docs/DESIGN.md §2).
export class History {
  constructor(getProject, setProject, onChange = () => {}, limit = 200) {
    this.get = getProject; this.set = setProject; this.onChange = onChange; this.limit = limit;
    this.undoStack = []; this.redoStack = [];
  }

  /** Snapshot, run fn(project) to mutate, record an undo step. Returns fn's result. */
  transact(label, fn) {
    const before = structuredClone(this.get());
    const result = fn(this.get());
    this.undoStack.push({ label, snapshot: before });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange(label);
    return result;
  }

  undo() { this.#swap(this.undoStack, this.redoStack); }
  redo() { this.#swap(this.redoStack, this.undoStack); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  clear() { this.undoStack.length = 0; this.redoStack.length = 0; }

  #swap(from, to) {
    const step = from.pop();
    if (!step) return;
    to.push({ label: step.label, snapshot: structuredClone(this.get()) });
    this.set(step.snapshot);
    this.onChange(step.label);
  }
}

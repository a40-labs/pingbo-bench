/**
 * The char state machine that reads a `mysqldump` INSERT stream without a MySQL server, lifted
 * out of `sappelli.ts` so a second reader of the same 178 MB dump does not carry a second copy
 * of it: one reader takes two of the dump's tables for a wanted set of ids, and the
 * reply-behaviour derivation takes three, over the WHOLE table rather than a wanted set.
 *
 * The dump's one INSERT shape is
 *   INSERT INTO `<table>` (`col`, …) VALUES (…), (…);
 * with backslash string escapes, and a chunk boundary may fall anywhere — so every bit of state
 * lives on the instance across `push()`, and a reader may feed it one character at a time.
 *
 * A sink declares which tables it reads and, per table, the field holding the row key, the tuple
 * ARITY (a tuple of another width is refused rather than mis-joined — the refusal this machine
 * has always made) and any fields whose text it does not want. A skipped field still contributes
 * an empty placeholder so `fields.length` keeps measuring the tuple's real width; that is what
 * lets a reader stream `message` for 252,759 rows without ever materialising a body.
 */

export interface SqlTableSpec {
  /** Field index holding the row key — the value handed to `keep()`. */
  keyField: number;
  /** Tuple width the dump writes for this table. */
  arity: number;
  /** Field indexes whose text is discarded as it streams (never the key field). */
  skipFields?: readonly number[];
}

export interface SqlDumpSink {
  readonly tables: Readonly<Record<string, SqlTableSpec>>;
  /** Called as the key field closes. `false` discards the rest of the tuple's text. */
  keep(table: string, key: string): boolean;
  /** Called at tuple end, only for a kept tuple of the declared arity. */
  row(table: string, fields: readonly string[]): void;
}

const INSERT_PREFIX = "INSERT INTO `";

type ScanMode = "seekInsert" | "tableName" | "afterInsert" | "columnList" | "expectTuple" | "inTuple";

export class SqlDumpScanner {
  private mode: ScanMode = "seekInsert";
  private matchPos = 0;
  private table = "";
  private keyField = 0;
  private arity = 0;
  private skip: ReadonlySet<number> = new Set();
  private inString = false;
  private escaped = false;
  private fieldIdx = 0;
  private fields: string[] = [];
  private buf = "";
  private keepTuple = true;

  constructor(private readonly sink: SqlDumpSink) {}

  push(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i] as string;
      switch (this.mode) {
        case "seekInsert":
          if (c === INSERT_PREFIX[this.matchPos]) {
            this.matchPos++;
            if (this.matchPos === INSERT_PREFIX.length) {
              this.mode = "tableName";
              this.matchPos = 0;
              this.table = "";
            }
          } else {
            this.matchPos = c === INSERT_PREFIX[0] ? 1 : 0;
          }
          break;
        case "tableName":
          // The name closes on its backtick; an unknown table is skipped whole, so a dump that
          // grows a table this sink does not read costs nothing here.
          if (c === "`") {
            const spec = this.sink.tables[this.table];
            if (spec) {
              this.keyField = spec.keyField;
              this.arity = spec.arity;
              this.skip = new Set(spec.skipFields ?? []);
              this.mode = "afterInsert";
            } else {
              this.mode = "seekInsert";
            }
          } else {
            this.table += c;
          }
          break;
        case "afterInsert":
          if (c === "(") this.mode = "columnList";
          break;
        case "columnList":
          if (c === ")") this.mode = "expectTuple";
          break;
        case "expectTuple":
          if (c === "(") this.beginTuple();
          else if (c === ";") this.mode = "seekInsert";
          break;
        case "inTuple":
          this.tupleChar(c);
          break;
      }
    }
  }

  private beginTuple(): void {
    this.mode = "inTuple";
    this.inString = false;
    this.escaped = false;
    this.fieldIdx = 0;
    this.fields = [];
    this.buf = "";
    this.keepTuple = true;
  }

  private tupleChar(c: string): void {
    if (this.inString) {
      if (this.escaped) {
        this.appendEscaped(c);
        this.escaped = false;
      } else if (c === "\\") {
        this.escaped = true;
      } else if (c === "'") {
        this.inString = false;
      } else {
        this.append(c);
      }
      return;
    }
    if (c === "'") {
      this.inString = true;
      return;
    }
    if (c === ",") {
      this.endField();
      return;
    }
    if (c === ")") {
      this.endField();
      this.endTuple();
      this.mode = "expectTuple";
      return;
    }
    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") this.append(c);
  }

  private append(c: string): void {
    if (this.collecting()) this.buf += c;
  }

  /** The key field decides `keepTuple` at ITS OWN boundary, so every field up to and including
   *  it is collected; past it, a dropped tuple and a skipped column both cost nothing. */
  private collecting(): boolean {
    if (this.skip.has(this.fieldIdx)) return false;
    return this.keepTuple || this.fieldIdx <= this.keyField;
  }

  private appendEscaped(c: string): void {
    const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", "0": "\0", Z: "\x1a" };
    this.append(map[c] ?? c);
  }

  private endField(): void {
    if (this.fieldIdx === this.keyField) this.keepTuple = this.sink.keep(this.table, this.buf);
    this.fields.push(this.collecting() ? this.buf : "");
    this.buf = "";
    this.fieldIdx++;
  }

  private endTuple(): void {
    if (!this.keepTuple) return;
    if (this.fields.length !== this.arity) return; // wrong shape for this table; refuse to join
    this.sink.row(this.table, this.fields);
  }
}

/** A bare SQL `NULL` reaches a projection as the token itself; every column that can be NULL
 *  reads as the empty string rather than the word. Quoting is not tracked, so a literal value of
 *  `'NULL'` would flatten too — none exists in this dump's address, date or rtype columns. */
export function nullableField(field: string | undefined): string {
  return field === undefined || field === "NULL" ? "" : field;
}

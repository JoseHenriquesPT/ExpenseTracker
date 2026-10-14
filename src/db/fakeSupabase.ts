// Shared test double for the supabase-js query builder: records every call and
// resolves to a canned result, so the DB-layer tests can assert exactly which
// filters and payloads would be sent without a real Supabase.
//
// Only imported by test files; never bundled.

export interface QueryCall {
  method: string;
  args: unknown[];
}

export interface QueryOutcome {
  data: unknown;
  error: unknown;
}

export class FakeQuery {
  calls: QueryCall[] = [];

  constructor(private readonly result: QueryOutcome) {}

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  select(...args: unknown[]): this { return this.record("select", args); }
  insert(...args: unknown[]): this { return this.record("insert", args); }
  update(...args: unknown[]): this { return this.record("update", args); }
  delete(...args: unknown[]): this { return this.record("delete", args); }
  eq(...args: unknown[]): this { return this.record("eq", args); }
  neq(...args: unknown[]): this { return this.record("neq", args); }
  is(...args: unknown[]): this { return this.record("is", args); }
  gt(...args: unknown[]): this { return this.record("gt", args); }
  order(...args: unknown[]): this { return this.record("order", args); }
  limit(...args: unknown[]): this { return this.record("limit", args); }

  maybeSingle(): Promise<QueryOutcome> {
    this.calls.push({ method: "maybeSingle", args: [] });
    return Promise.resolve(this.result);
  }

  single(): Promise<QueryOutcome> {
    this.calls.push({ method: "single", args: [] });
    return Promise.resolve(this.result);
  }

  then<TResult1 = QueryOutcome, TResult2 = never>(
    onfulfilled?: ((value: QueryOutcome) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

/** Anything shaped like a `vi.fn()` we can queue an implementation on. */
export interface MockQueue {
  mockImplementationOnce(fn: () => FakeQuery): unknown;
}

/** Queue the next `supabase.from(...)` call to return a fake query builder. */
export function queueQuery(
  from: MockQueue,
  result: { data?: unknown; error?: unknown } = {},
): FakeQuery {
  const q = new FakeQuery({
    data: result.data === undefined ? [] : result.data,
    error: result.error ?? null,
  });
  from.mockImplementationOnce(() => q);
  return q;
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock("./supabase", () => ({ supabase: { rpc, from } }));
vi.mock("./live", () => ({ touch: vi.fn() }));

import {
  createHousehold, createInvite, dismantleHousehold, fetchHousehold, joinHousehold,
  listInvites, mergeIntoHousehold, revokeInvite, upgradeToCouple,
} from "./householdApi";
import { getHousehold, getHouseholdSnapshot, setHousehold } from "./household";
import { type FakeQuery, queueQuery } from "./fakeSupabase";

/** Queue the next `supabase.from(...)` call to return a fake query builder. */
function next(result: { data?: unknown; error?: unknown } = {}): FakeQuery {
  return queueQuery(from, result);
}

/** Route RPC calls by function name; unknown names fail loudly. */
function rpcHandler(handlers: Record<string, unknown>): void {
  rpc.mockImplementation(async (fn: string) => {
    if (!(fn in handlers)) throw new Error(`Unexpected RPC: ${fn}`);
    const h = handlers[fn];
    return typeof h === "function" ? (h as () => unknown)() : h;
  });
}

const ROW = { id: 3, name: "Beta", kind: "single", memberCount: 1 };

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  setHousehold(null);
});

describe("fetchHousehold", () => {
  it("returns null when the account has no household", async () => {
    rpcHandler({ current_household: { data: [], error: null } });
    await expect(fetchHousehold()).resolves.toBeNull();
    expect(getHouseholdSnapshot()).toBeNull();
  });

  it("maps the RPC row to a Household", async () => {
    rpcHandler({ current_household: { data: [ROW], error: null } });
    await expect(fetchHousehold()).resolves.toEqual({
      id: 3, name: "Beta", kind: "single", memberCount: 1,
    });
  });

  it("surfaces RPC errors", async () => {
    rpcHandler({ current_household: { data: null, error: { message: "boom" } } });
    await expect(fetchHousehold()).rejects.toMatchObject({ message: "boom" });
  });
});

describe("createHousehold", () => {
  it("creates the household and refreshes the module state", async () => {
    rpcHandler({
      create_household: { data: 3, error: null },
      current_household: { data: [ROW], error: null },
    });
    await createHousehold("single");
    expect(rpc).toHaveBeenCalledWith("create_household", { p_kind: "single" });
    expect(getHousehold()).toEqual({ id: 3, name: "Beta", kind: "single", memberCount: 1 });
  });

  it("surfaces the database error and leaves the state unset", async () => {
    rpcHandler({
      create_household: {
        data: null,
        error: { message: "This account already belongs to a household." },
      },
    });
    await expect(createHousehold("couple")).rejects.toThrow(
      "This account already belongs to a household.",
    );
    expect(getHouseholdSnapshot()).toBeNull();
  });
});

describe("joinHousehold", () => {
  it("passes the code through and refreshes the module state", async () => {
    rpcHandler({
      join_household: { data: 3, error: null },
      current_household: {
        data: [{ ...ROW, kind: "couple", memberCount: 2 }],
        error: null,
      },
    });
    await joinHousehold("ABC123");
    expect(rpc).toHaveBeenCalledWith("join_household", { p_code: "ABC123" });
    expect(getHousehold()).toMatchObject({ kind: "couple", memberCount: 2 });
  });

  it("surfaces the database error message", async () => {
    rpcHandler({
      join_household: { data: null, error: { message: "That invite code is not valid." } },
    });
    await expect(joinHousehold("NOPE")).rejects.toThrow("That invite code is not valid.");
  });
});

describe("mergeIntoHousehold", () => {
  it("passes the code through and refreshes to the partner's household", async () => {
    rpcHandler({
      merge_into_household: { data: 3, error: null },
      current_household: {
        data: [{ ...ROW, kind: "couple", memberCount: 2 }],
        error: null,
      },
    });
    await mergeIntoHousehold("ABC123");
    expect(rpc).toHaveBeenCalledWith("merge_into_household", { p_code: "ABC123" });
    expect(getHousehold()).toMatchObject({ kind: "couple", memberCount: 2 });
  });

  it("maps the database error message to its translation", async () => {
    rpcHandler({
      merge_into_household: {
        data: null,
        error: { message: "Your household has another member — dismantle it before joining another." },
      },
    });
    await expect(mergeIntoHousehold("NOPE")).rejects.toThrow(/another member/);
  });

  it("hides unmapped database errors behind a generic sentence", async () => {
    rpcHandler({
      merge_into_household: { data: null, error: { message: "permission denied for table x" } },
    });
    await expect(mergeIntoHousehold("NOPE")).rejects.toThrow(/something went wrong/i);
  });
});

describe("dismantleHousehold", () => {
  it("calls the RPC and clears the module household", async () => {
    setHousehold({ id: 3, name: "Beta", kind: "couple", memberCount: 2 });
    rpcHandler({
      dismantle_household: { data: null, error: null },
      current_household: { data: [], error: null },
    });
    await dismantleHousehold();
    expect(rpc).toHaveBeenCalledWith("dismantle_household", {});
    expect(getHouseholdSnapshot()).toBeNull();
  });

  it("surfaces failures and keeps the household", async () => {
    setHousehold({ id: 3, name: "Beta", kind: "couple", memberCount: 2 });
    rpcHandler({
      dismantle_household: { data: null, error: { message: "Sign in first." } },
    });
    await expect(dismantleHousehold()).rejects.toThrow("Sign in first.");
    expect(getHouseholdSnapshot()).not.toBeNull();
  });
});

describe("upgradeToCouple", () => {
  it("changes the kind and refreshes the module state", async () => {
    setHousehold({ id: 3, name: "Beta", kind: "single", memberCount: 1 });
    rpcHandler({
      set_household_kind: { data: null, error: null },
      current_household: {
        data: [{ ...ROW, kind: "couple" }],
        error: null,
      },
    });
    await upgradeToCouple();
    expect(rpc).toHaveBeenCalledWith("set_household_kind", { p_kind: "couple" });
    expect(getHousehold().kind).toBe("couple");
  });
});

describe("invites", () => {
  beforeEach(() => {
    setHousehold({ id: 3, name: "Beta", kind: "couple", memberCount: 2 });
  });

  it("createInvite calls the create_invite RPC and returns the code", async () => {
    rpcHandler({ create_invite: { data: { id: 9, code: "abc123def456" }, error: null } });
    await expect(createInvite()).resolves.toEqual({ id: 9, code: "abc123def456" });
    expect(rpc).toHaveBeenCalledWith("create_invite");
    expect(from).not.toHaveBeenCalled();
  });

  it("createInvite fails cleanly without a household", async () => {
    setHousehold(null);
    await expect(createInvite()).rejects.toThrow(/household/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("listInvites returns only active invites of the household", async () => {
    const q = next({
      data: [
        { id: 9, code: "abc123def456" },
        { id: 10, code: "ffffffffffff" },
      ],
    });
    await expect(listInvites()).resolves.toHaveLength(2);
    expect(q.calls.find((c) => c.method === "select")?.args[0]).toContain("code");
    expect(q.calls).toContainEqual({ method: "eq", args: ["householdId", 3] });
    expect(q.calls).toContainEqual({ method: "is", args: ["usedAt", null] });
    expect(q.calls.some((c) => c.method === "gt" && c.args[0] === "expiresAt")).toBe(true);
    expect(q.calls).toContainEqual({ method: "order", args: ["id"] });
  });

  it("revokeInvite deletes by id", async () => {
    const q = next({ data: null });
    await revokeInvite(9);
    expect(q.calls.some((c) => c.method === "delete")).toBe(true);
    expect(q.calls).toContainEqual({ method: "eq", args: ["id", 9] });
  });

  it("revokeInvite surfaces failures", async () => {
    next({ data: null, error: { message: "denied" } });
    await expect(revokeInvite(9)).rejects.toThrow(/something went wrong/i);
  });
});

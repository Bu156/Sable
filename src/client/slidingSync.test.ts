/**
 * Unit tests for SlidingSyncManager memory management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MatrixClient, MSC3575List } from '$types/matrix-sdk';
import { EventType, KnownMembership, SlidingSyncEvent, SlidingSyncState } from '$types/matrix-sdk';

import { SlidingSyncManager } from './slidingSync';

// ── vi.hoisted mocks ─────────────────────────────────────────────────────────
// Must be defined via vi.hoisted
const mocks = vi.hoisted(() => ({
  slidingSyncConstructorArgs: undefined as unknown[] | undefined,
  slidingSyncInstance: {
    on: vi.fn<(event: unknown, handler: unknown) => void>(),
    off: vi.fn<() => void>(),
    removeListener: vi.fn<() => void>(),
    stop: vi.fn<() => void>(),
    modifyRoomSubscriptions: vi.fn<() => void>(),
    modifyRoomSubscriptionInfo: vi.fn<() => void>(),
    addCustomSubscription: vi.fn<() => void>(),
    useCustomSubscription: vi.fn<() => void>(),
    registerExtension: vi.fn<() => void>(),
    getListData: vi.fn<(key: string) => null>(),
    getListParams: vi.fn<(key: string) => null>(),
    setList: vi.fn<() => void>(),
    setListRanges: vi.fn<(key: string, ranges: number[][]) => void>(),
  },
}));

// ── Sentry stub ──────────────────────────────────────────────────────────────
vi.mock('@sentry/react', () => ({
  metrics: {
    count: vi.fn<() => void>(),
    gauge: vi.fn<() => void>(),
    distribution: vi.fn<() => void>(),
  },
  addBreadcrumb: vi.fn<() => void>(),
  startInactiveSpan:
    vi.fn<() => { setAttribute: () => void; setAttributes: () => void; end: () => void }>(),
  startSpan: vi.fn<() => Promise<unknown>>(),
}));

// ── SlidingSync SDK mock ─────────────────────────────────────────────────────
// A plain function constructor is the correct pattern
vi.mock('$types/matrix-sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  function MockSlidingSync(...args: unknown[]) {
    mocks.slidingSyncConstructorArgs = args;
    return mocks.slidingSyncInstance;
  }
  return { ...actual, SlidingSync: MockSlidingSync };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockMx(overrides: Record<string, unknown> = {}) {
  return {
    getUserId: vi.fn<() => string>().mockReturnValue('@user:example.com'),
    getSafeUserId: vi.fn<() => string>().mockReturnValue('@user:example.com'),
    isRoomEncrypted: vi.fn<() => boolean>().mockReturnValue(false),
    getRoom: vi.fn<() => null>().mockReturnValue(null),
    getJoinedRooms: vi.fn<() => Promise<{ joined_rooms: string[] }>>().mockResolvedValue({
      joined_rooms: [],
    }),
    on: vi.fn<() => void>(),
    off: vi.fn<() => void>(),
    removeListener: vi.fn<() => void>(),
    ...overrides,
  } as unknown as MatrixClient;
}

function makeManager(mx: ReturnType<typeof makeMockMx>): SlidingSyncManager {
  return new SlidingSyncManager(mx, 'https://sliding.example.com');
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.slidingSyncInstance.getListData.mockReset().mockReturnValue(null);
  mocks.slidingSyncInstance.getListParams.mockReset().mockReturnValue(null);
  mocks.slidingSyncInstance.setListRanges.mockReset();
  mocks.slidingSyncConstructorArgs = undefined;
});

function fireLifecycle(state: SlidingSyncState, response: unknown = {}) {
  const lifecycleCall = mocks.slidingSyncInstance.on.mock.calls.find(
    ([event]) => event === SlidingSyncEvent.Lifecycle
  );
  const lifecycle = lifecycleCall?.[1] as
    | ((nextState: SlidingSyncState, nextResponse: unknown, error?: Error) => void)
    | undefined;
  lifecycle?.(state, response);
}

function fireRoomData(roomId: string) {
  const roomDataHandler = mocks.slidingSyncInstance.on.mock.calls
    .toReversed()
    .find(([event]) => event === SlidingSyncEvent.RoomData)?.[1] as
    | ((dataRoomId: string, data: unknown) => void)
    | undefined;
  roomDataHandler?.(roomId, {});
}

describe('SlidingSyncManager initial request', () => {
  it('starts with a small room-list range and only row-level state', () => {
    makeManager(makeMockMx());

    const lists = mocks.slidingSyncConstructorArgs?.[1] as Map<string, MSC3575List>;
    const joined = lists.get('joined');
    const defaultSubscription = mocks.slidingSyncConstructorArgs?.[2] as {
      timeline_limit: number;
    };

    expect(joined?.ranges).toEqual([[0, 29]]);
    expect(joined?.timeline_limit).toBe(1);
    expect(joined?.required_state).toHaveLength(8);
    expect(joined?.required_state).toContainEqual([EventType.RoomJoinRules, '']);
    expect(joined?.required_state).not.toContainEqual(['m.space.child', '*']);
    expect(defaultSubscription.timeline_limit).toBe(30);
    expect(mocks.slidingSyncConstructorArgs?.[4]).toBe(45000);
  });

  it('settles response processing after post-response work can finish', async () => {
    const manager = makeManager(makeMockMx());
    const settled = vi.fn<() => void>();
    manager.subscribeToResponseSettled(settled);
    manager.attach();

    fireLifecycle(SlidingSyncState.RequestFinished, {});
    expect(manager.isResponseProcessing()).toBe(true);

    fireLifecycle(SlidingSyncState.Complete, {});
    expect(manager.isResponseProcessing()).toBe(true);
    expect(settled).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(manager.isResponseProcessing()).toBe(false);
    expect(settled).toHaveBeenCalledOnce();
  });

  it('includes the selected room subscription before the first request', () => {
    const manager = new SlidingSyncManager(makeMockMx(), 'https://sliding.example.com', {
      initialRoomIds: ['!selected:example.com'],
    });

    expect(manager.isRoomActive('!selected:example.com')).toBe(true);
    expect(mocks.slidingSyncInstance.useCustomSubscription).toHaveBeenCalledWith(
      '!selected:example.com',
      'active_room'
    );
    expect(mocks.slidingSyncInstance.modifyRoomSubscriptions).toHaveBeenCalledWith(
      new Set(['!selected:example.com'])
    );
  });

  it('expands by one page after the first response instead of jumping to all rooms', () => {
    const manager = makeManager(makeMockMx());
    mocks.slidingSyncInstance.getListData.mockImplementation((key: string) =>
      key === 'joined' ? ({ joinedCount: 1000 } as never) : null
    );
    mocks.slidingSyncInstance.getListParams.mockReturnValue({
      ranges: [[0, 29]],
    } as never);
    manager.attach();

    const lifecycleCall = mocks.slidingSyncInstance.on.mock.calls.find(
      ([event]) => event === SlidingSyncEvent.Lifecycle
    );
    const lifecycle = lifecycleCall?.[1] as
      | ((state: SlidingSyncState, response: unknown, error?: Error) => void)
      | undefined;
    lifecycle?.(SlidingSyncState.Complete, {});

    expect(mocks.slidingSyncInstance.setListRanges).toHaveBeenCalledWith('joined', [[0, 59]]);
  });

  it('does not expand lists synchronously while adding an active-room subscription', () => {
    const manager = makeManager(makeMockMx());
    mocks.slidingSyncInstance.getListData.mockImplementation((key: string) =>
      key === 'joined' ? ({ joinedCount: 1000 } as never) : null
    );
    mocks.slidingSyncInstance.getListParams.mockReturnValue({
      ranges: [[0, 29]],
    } as never);
    manager.attach();
    manager.subscribeToRoom('!active:example.com');

    expect(mocks.slidingSyncInstance.setListRanges).not.toHaveBeenCalledWith('joined', [[0, 59]]);

    const lifecycleCall = mocks.slidingSyncInstance.on.mock.calls.find(
      ([event]) => event === SlidingSyncEvent.Lifecycle
    );
    const lifecycle = lifecycleCall?.[1] as
      | ((state: SlidingSyncState, response: unknown, error?: Error) => void)
      | undefined;
    lifecycle?.(SlidingSyncState.Complete, {});

    expect(mocks.slidingSyncInstance.setListRanges).toHaveBeenCalledWith('joined', [[0, 59]]);
  });

  it('prioritizes active subscriptions while an expanded range is awaiting its response', () => {
    let joinedRange: [number, number][] = [[0, 29]];
    const manager = makeManager(makeMockMx());
    mocks.slidingSyncInstance.getListData.mockImplementation((key: string) =>
      key === 'joined' ? ({ joinedCount: 193 } as never) : null
    );
    mocks.slidingSyncInstance.getListParams.mockImplementation((key: string) =>
      key === 'joined' ? ({ ranges: joinedRange } as never) : ({ ranges: [[0, 29]] } as never)
    );
    mocks.slidingSyncInstance.setListRanges.mockImplementation((key, ranges) => {
      if (key === 'joined') joinedRange = ranges as [number, number][];
    });
    manager.attach();

    fireLifecycle(SlidingSyncState.Complete);
    manager.subscribeToRoom('!active:example.com');

    const diagnostics = manager.getDiagnostics();
    expect(manager.isRoomActive('!active:example.com')).toBe(true);
    expect(mocks.slidingSyncInstance.modifyRoomSubscriptions).toHaveBeenCalledWith(
      new Set(['!active:example.com'])
    );
    expect(mocks.slidingSyncInstance.useCustomSubscription).toHaveBeenCalledWith(
      '!active:example.com',
      'active_room'
    );
    expect(diagnostics.lists.find((list) => list.key === 'joined')).toMatchObject({
      rangeEnd: 29,
    });
  });
});

describe('SlidingSyncManager room subscription coordination', () => {
  it('reports loading until the subscribed room returns data', () => {
    const manager = makeManager(makeMockMx());
    const roomId = '!slow:example.com';
    const loadingStates: boolean[] = [];

    manager.onRoomSubscriptionStatus(roomId, (loading) => loadingStates.push(loading));
    manager.subscribeToRoom(roomId);

    fireRoomData(roomId);
    expect(loadingStates).toEqual([false, true]);
    expect(manager.isRoomSubscriptionLoading(roomId)).toBe(true);

    manager.attach();
    fireLifecycle(SlidingSyncState.Complete);

    expect(loadingStates).toEqual([false, true, false]);
  });

  it('uses the active subscription while a room is also an image-pack room', () => {
    const manager = makeManager(makeMockMx());
    const roomId = '!pack:example.com';

    manager.setImagePackSubscriptions([roomId]);
    manager.subscribeToRoom(roomId);

    expect(mocks.slidingSyncInstance.useCustomSubscription).toHaveBeenLastCalledWith(
      roomId,
      'active_room'
    );
  });

  it('restores the image-pack subscription when the room is no longer active', () => {
    const manager = makeManager(makeMockMx());
    const roomId = '!pack:example.com';

    manager.setImagePackSubscriptions([roomId]);
    manager.subscribeToRoom(roomId);
    manager.unsubscribeFromRoom(roomId);

    expect(mocks.slidingSyncInstance.useCustomSubscription).toHaveBeenLastCalledWith(
      roomId,
      'image_packs'
    );
    expect(mocks.slidingSyncInstance.modifyRoomSubscriptions).toHaveBeenLastCalledWith(
      new Set([roomId])
    );
  });

  it('removes image-pack subscriptions which are no longer configured', () => {
    const manager = makeManager(makeMockMx());

    manager.setImagePackSubscriptions(['!old:example.com', '!current:example.com']);
    manager.setImagePackSubscriptions(['!current:example.com']);

    expect(mocks.slidingSyncInstance.modifyRoomSubscriptions).toHaveBeenLastCalledWith(
      new Set(['!current:example.com'])
    );
  });
});

describe('SlidingSyncManager local membership reconciliation', () => {
  it('updates an existing invite immediately after a successful join', () => {
    const updateMyMembership = vi.fn<() => void>();
    const manager = makeManager(
      makeMockMx({
        getRoom: vi.fn<() => { updateMyMembership: typeof updateMyMembership }>().mockReturnValue({
          updateMyMembership,
        }),
      })
    );

    manager.reconcileRoomMembership('!invite:example.com', KnownMembership.Join);

    expect(updateMyMembership).toHaveBeenCalledWith(KnownMembership.Join);
  });

  it('updates and unsubscribes a room immediately after a successful leave', () => {
    const updateMyMembership = vi.fn<() => void>();
    const manager = makeManager(
      makeMockMx({
        getRoom: vi.fn<() => { updateMyMembership: typeof updateMyMembership }>().mockReturnValue({
          updateMyMembership,
        }),
      })
    );
    manager.subscribeToRoom('!room:example.com');

    manager.reconcileRoomMembership('!room:example.com', KnownMembership.Leave);

    expect(updateMyMembership).toHaveBeenCalledWith(KnownMembership.Leave);
    expect(manager.isRoomActive('!room:example.com')).toBe(false);
    expect(mocks.slidingSyncInstance.modifyRoomSubscriptions).toHaveBeenLastCalledWith(new Set());
  });

  it('waits for cache hydration and unions authoritative joined rooms before reconciling', async () => {
    let finishHydration: ((hydrated: boolean) => void) | undefined;
    const hydration = new Promise<boolean>((resolve) => {
      finishHydration = resolve;
    });
    const getJoinedRooms = vi.fn<() => Promise<{ joined_rooms: string[] }>>().mockResolvedValue({
      joined_rooms: ['!authoritative:example.com'],
    });
    const manager = makeManager(makeMockMx({ getJoinedRooms }));
    const internals = manager as unknown as {
      cacheHydrationPromise: Promise<boolean>;
      reconcileSidebarCacheMembership: () => void;
      serverMembershipRoomIds: Set<string>;
      sidebarCache: { reconcileRooms: (roomIds: ReadonlySet<string>) => string[] };
    };
    internals.cacheHydrationPromise = hydration;
    internals.serverMembershipRoomIds.add('!observed:example.com');
    const reconcileRooms = vi.spyOn(internals.sidebarCache, 'reconcileRooms').mockReturnValue([]);

    internals.reconcileSidebarCacheMembership();
    expect(getJoinedRooms).not.toHaveBeenCalled();

    finishHydration?.(true);
    await vi.waitFor(() => expect(reconcileRooms).toHaveBeenCalledOnce());

    expect(getJoinedRooms).toHaveBeenCalledOnce();
    expect(reconcileRooms).toHaveBeenCalledWith(
      new Set(['!observed:example.com', '!authoritative:example.com'])
    );
  });

  it('keeps cached rooms when authoritative membership cannot be fetched', async () => {
    const getJoinedRooms = vi.fn<() => Promise<{ joined_rooms: string[] }>>().mockRejectedValue(
      new Error('offline')
    );
    const manager = makeManager(makeMockMx({ getJoinedRooms }));
    const internals = manager as unknown as {
      reconcileSidebarCacheMembership: () => void;
      sidebarCache: { reconcileRooms: (roomIds: ReadonlySet<string>) => string[] };
    };
    const reconcileRooms = vi.spyOn(internals.sidebarCache, 'reconcileRooms').mockReturnValue([]);

    internals.reconcileSidebarCacheMembership();
    await vi.waitFor(() => expect(getJoinedRooms).toHaveBeenCalledOnce());

    expect(reconcileRooms).not.toHaveBeenCalled();
  });
});

// ── dispose() ────────────────────────────────────────────────────────────────

describe('SlidingSyncManager.dispose()', () => {
  it('calls slidingSync.stop() to halt the polling loop', () => {
    const manager = makeManager(makeMockMx());
    manager.dispose();
    expect(mocks.slidingSyncInstance.stop).toHaveBeenCalledOnce();
  });
});

// ── onMembershipLeave: auto-unsubscribe on leave/ban ─────────────────────────

/** Fire the RoomMemberEvent.Membership listener registered on mx.on */
function fireMembershipEvent(
  mx: ReturnType<typeof makeMockMx>,
  membership: string,
  roomId = '!room:example.com',
  userId = '@user:example.com'
) {
  const onCall = (mx.on as ReturnType<typeof vi.fn>).mock.calls.find(
    (args: unknown[]) => args[0] === 'RoomMember.membership'
  );
  if (!onCall) throw new Error('onMembershipLeave listener not registered');
  const [, handler] = onCall as [
    string,
    (e: unknown, m: { userId: string; roomId: string; membership: string }) => void,
  ];
  handler(undefined, { userId, roomId, membership });
}

describe('SlidingSyncManager — membership leave auto-unsubscribe', () => {
  it('unsubscribes when the local user leaves an active room', () => {
    const mx = makeMockMx();
    const manager = makeManager(mx);
    manager.attach();
    fireLifecycle(SlidingSyncState.Complete);
    manager.subscribeToRoom('!room:example.com');

    fireMembershipEvent(mx, 'leave');

    // subscribeToRoom + unsubscribeFromRoom = 2 calls
    expect(mocks.slidingSyncInstance.modifyRoomSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes when the local user is banned from an active room', () => {
    const mx = makeMockMx();
    const manager = makeManager(mx);
    manager.attach();
    fireLifecycle(SlidingSyncState.Complete);
    manager.subscribeToRoom('!room:example.com');

    fireMembershipEvent(mx, 'ban');

    expect(mocks.slidingSyncInstance.modifyRoomSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('does nothing when a different user leaves', () => {
    const mx = makeMockMx();
    const manager = makeManager(mx);
    manager.attach();
    fireLifecycle(SlidingSyncState.Complete);
    manager.subscribeToRoom('!room:example.com');

    fireMembershipEvent(mx, 'leave', '!room:example.com', '@other:example.com');

    // Only the initial subscribe — no unsubscribe
    expect(mocks.slidingSyncInstance.modifyRoomSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('does nothing when membership is join', () => {
    const mx = makeMockMx();
    const manager = makeManager(mx);
    manager.attach();
    fireLifecycle(SlidingSyncState.Complete);
    manager.subscribeToRoom('!room:example.com');

    fireMembershipEvent(mx, 'join');

    expect(mocks.slidingSyncInstance.modifyRoomSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a room that was never subscribed', () => {
    const mx = makeMockMx();
    const manager = makeManager(mx);
    manager.attach(); // registers the listener, but no subscribeToRoom call

    fireMembershipEvent(mx, 'leave');

    expect(mocks.slidingSyncInstance.modifyRoomSubscriptions).not.toHaveBeenCalled();
  });
});

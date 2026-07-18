export interface CommandError {
  code: string;
  message: string;
  requestId?: number;
}

export function commandErrorMatches(
  pendingRequestId: number | null,
  error: CommandError | null,
): boolean {
  return pendingRequestId !== null && error?.requestId === pendingRequestId;
}

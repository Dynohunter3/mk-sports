export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

export class OfflineError extends Error {
  constructor(message = "You're offline") {
    super(message);
  }
}

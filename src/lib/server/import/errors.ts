/** A problem with what was sent, safe to show to the user as it is. */
export class UploadError extends Error {
  status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

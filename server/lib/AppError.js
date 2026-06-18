class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isSafe = true;
  }
}

module.exports = AppError;

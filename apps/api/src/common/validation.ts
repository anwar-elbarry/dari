import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { VALIDATION_FAILED } from './http-exception.filter';

export interface FieldError {
  field: string;
  errors: string[];
}

/** Flatten nested class-validator errors into `field.path: [messages]`. Submitted values are not echoed back. */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, errors: Object.values(e.constraints) }] : [];
    return [...own, ...flattenValidationErrors(e.children ?? [], field)];
  });
}

/** Global input validation: unknown fields are rejected, not silently stripped. */
export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: VALIDATION_FAILED,
        message: 'Request validation failed.',
        details: flattenValidationErrors(errors),
      }),
  });
}

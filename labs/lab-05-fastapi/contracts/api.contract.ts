export interface PartRequest {
  readonly designation: string;
  readonly name: string;
  readonly material?: string | null;
}

export interface PartDto {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly material: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PartResponse {
  readonly part: PartDto;
}

export interface PartsResponse {
  readonly parts: readonly PartDto[];
}

export interface OperationTypeRequest {
  readonly name: string;
  readonly description?: string | null;
}

export interface OperationTypeDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OperationTypeResponse {
  readonly operationType: OperationTypeDto;
}

export interface OperationTypesResponse {
  readonly operationTypes: readonly OperationTypeDto[];
}

export interface OperationRequest {
  readonly operationTypeId: string;
  readonly equipment?: string | null;
  readonly durationMinutes: number;
}

export interface ProcessCardRequest {
  readonly partId: string;
  readonly operations: readonly OperationRequest[];
}

export interface PartRefDto {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly material: string | null;
}

export interface OperationTypeRefDto {
  readonly id: string;
  readonly name: string;
}

export interface OperationDto {
  readonly number: number;
  readonly operationType: OperationTypeRefDto;
  readonly equipment: string | null;
  readonly durationMinutes: number;
}

export interface ProcessCardDto {
  readonly id: string;
  readonly part: PartRefDto;
  readonly operations: readonly OperationDto[];
  readonly totalDurationMinutes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProcessCardResponse {
  readonly processCard: ProcessCardDto;
}

export interface ProcessCardsResponse {
  readonly processCards: readonly ProcessCardDto[];
}

export interface WorkloadDto {
  readonly operationType: OperationTypeRefDto;
  readonly operations: number;
  readonly totalDurationMinutes: number;
}

export interface StatisticsResponse {
  readonly parts: number;
  readonly operationTypes: number;
  readonly processCards: number;
  readonly operations: number;
  readonly totalDurationMinutes: number;
  readonly workload: readonly WorkloadDto[];
}

export interface HealthResponse {
  readonly status: 'ok' | 'degraded';
  readonly database: 'up' | 'down';
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PART_DESIGNATION_TAKEN'
  | 'OPERATION_TYPE_NAME_TAKEN'
  | 'PART_ALREADY_HAS_CARD'
  | 'PART_IN_USE'
  | 'OPERATION_TYPE_IN_USE'
  | 'UNKNOWN_PART'
  | 'UNKNOWN_OPERATION_TYPE'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ValidationIssueDto {
  readonly path: string;
  readonly message: string;
}

export interface ErrorResponse {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly issues?: readonly ValidationIssueDto[];
  };
}

import { InjectionToken } from '@angular/core';

export interface SwaggerUiOptions {
  readonly domNode: HTMLElement;
  readonly url: string;
  readonly onComplete: () => void;
  readonly [option: string]: unknown;
}

export type SwaggerUiRenderer = (options: SwaggerUiOptions) => unknown;

export const SWAGGER_UI_STYLESHEET = 'swagger-ui.css';

export const SWAGGER_UI = new InjectionToken<() => Promise<SwaggerUiRenderer>>('SWAGGER_UI', {
  providedIn: 'root',
  factory: () => async () => (await import('swagger-ui-dist/swagger-ui-es-bundle.js')).default,
});

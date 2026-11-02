declare module 'swagger-ui-dist/swagger-ui-es-bundle.js' {
  interface SwaggerUiOptions {
    readonly domNode: HTMLElement;
    readonly url: string;
    readonly [option: string]: unknown;
  }

  const SwaggerUI: (options: SwaggerUiOptions) => unknown;
  export default SwaggerUI;
}

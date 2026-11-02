import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { API } from '../../data-access/catalog-api';
import { SWAGGER_UI, SWAGGER_UI_STYLESHEET } from '../../data-access/swagger-ui';

const STYLESHEET_ID = 'swagger-ui-stylesheet';

@Component({
  selector: 'app-api-docs',
  templateUrl: './api-docs.html',
  styleUrl: './api-docs.css',
  encapsulation: ViewEncapsulation.None,
})
export class ApiDocs {
  readonly #document = inject(DOCUMENT);
  readonly #loadSwaggerUi = inject(SWAGGER_UI);
  private readonly container = viewChild.required<ElementRef<HTMLElement>>('swagger');

  protected readonly openApiUrl = API.openApi;
  protected readonly state = signal<'loading' | 'ready' | 'failed'>('loading');

  constructor() {
    afterNextRender(() => void this.#render());
  }

  async #render(): Promise<void> {
    this.#attachStylesheet();
    try {
      const render = await this.#loadSwaggerUi();
      render({
        domNode: this.container().nativeElement,
        url: API.openApi,
        deepLinking: false,
        tryItOutEnabled: true,
        displayRequestDuration: true,
        displayOperationId: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 0,
        defaultModelExpandDepth: 3,
        onComplete: () => this.state.set('ready'),
      });
    } catch {
      this.state.set('failed');
    }
  }

  #attachStylesheet(): void {
    if (this.#document.getElementById(STYLESHEET_ID)) {
      return;
    }
    const link = this.#document.createElement('link');
    link.id = STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = SWAGGER_UI_STYLESHEET;
    this.#document.head.append(link);
  }
}

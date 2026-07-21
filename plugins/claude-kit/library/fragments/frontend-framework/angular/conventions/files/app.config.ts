import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
<% if ui-kit.ng_provider_imports %><% ui-kit.ng_provider_imports %>
<% end %>
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient()<% if ui-kit.ng_providers %>,
    <% ui-kit.ng_providers %><% end %>
  ]
};

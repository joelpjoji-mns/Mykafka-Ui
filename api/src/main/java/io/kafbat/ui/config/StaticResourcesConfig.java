package io.kafbat.ui.config;

import java.time.Duration;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.reactive.config.ResourceHandlerRegistry;
import org.springframework.web.reactive.config.WebFluxConfigurer;

/**
 * Vite emits content-hashed file names under {@code /assets}, so those files never change for a
 * given URL and can be cached by browsers and proxies for a year. The SPA shell (index.html and
 * manifest.json) is served by {@link io.kafbat.ui.controller.StaticController} with
 * {@code no-cache} so new releases are picked up immediately.
 */
@Configuration
public class StaticResourcesConfig implements WebFluxConfigurer {

  static final CacheControl IMMUTABLE_ASSETS = CacheControl.maxAge(Duration.ofDays(365))
      .cachePublic()
      .immutable();

  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    registry.addResourceHandler("/assets/**")
        .addResourceLocations("classpath:/static/assets/")
        .setCacheControl(IMMUTABLE_ASSETS)
        .setUseLastModified(false);
  }
}

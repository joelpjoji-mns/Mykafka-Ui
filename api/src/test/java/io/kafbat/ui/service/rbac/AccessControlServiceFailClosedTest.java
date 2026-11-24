package io.kafbat.ui.service.rbac;

import static io.kafbat.ui.service.rbac.MockedRbacUtils.getAccessContext;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.kafbat.ui.config.auth.RoleBasedAccessControlProperties;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.mockito.Mockito;
import org.springframework.core.env.Environment;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.test.util.ReflectionTestUtils;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

class AccessControlServiceFailClosedTest {

  @Test
  void deniesAccessWhenPrincipalCannotBeMappedToAnRbacUser() {
    var service = new AccessControlService(
        mock(RoleBasedAccessControlProperties.class),
        mock(Environment.class));
    ReflectionTestUtils.setField(service, "rbacEnabled", true);

    SecurityContext securityContext = mock();
    Authentication authentication = mock();
    when(securityContext.getAuthentication()).thenReturn(authentication);
    when(authentication.getPrincipal()).thenReturn("unmapped-principal");

    try (MockedStatic<ReactiveSecurityContextHolder> contextHolder =
        Mockito.mockStatic(ReactiveSecurityContextHolder.class)) {
      contextHolder.when(ReactiveSecurityContextHolder::getContext).thenReturn(Mono.just(securityContext));

      StepVerifier.create(service.validateAccess(getAccessContext("cluster", true)))
          .expectError(AccessDeniedException.class)
          .verify();
    }
  }
}

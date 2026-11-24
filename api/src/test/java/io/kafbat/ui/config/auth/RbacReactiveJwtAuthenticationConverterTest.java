package io.kafbat.ui.config.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.kafbat.ui.model.rbac.Role;
import io.kafbat.ui.model.rbac.Subject;
import io.kafbat.ui.model.rbac.provider.Provider;
import io.kafbat.ui.service.rbac.AccessControlService;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.security.oauth2.resource.OAuth2ResourceServerProperties;
import org.springframework.security.oauth2.jwt.Jwt;

class RbacReactiveJwtAuthenticationConverterTest {

  @Test
  void mapsJwtUsernameAndAuthoritiesToConfiguredRbacGroups() {
    AccessControlService accessControlService = mock(AccessControlService.class);
    when(accessControlService.getRoles()).thenReturn(List.of(
        role("user-role", "user", "alice"),
        role("authority-role", "role", "ROLE_ops")));

    var jwtProperties = new OAuth2ResourceServerProperties.Jwt();
    jwtProperties.setPrincipalClaimName("preferred_username");
    jwtProperties.setAuthoritiesClaimName("permissions");
    jwtProperties.setAuthorityPrefix("ROLE_");

    Jwt jwt = Jwt.withTokenValue("token")
        .header("alg", "RS256")
        .subject("subject")
        .claim("preferred_username", "alice")
        .claim("permissions", List.of("ops"))
        .issuedAt(Instant.now())
        .expiresAt(Instant.now().plusSeconds(60))
        .build();

    var authentication = new RbacReactiveJwtAuthenticationConverter(accessControlService, jwtProperties)
        .convert(jwt)
        .block();

    assertThat(authentication).isInstanceOf(RbacBearerTokenAuthentication.class);
    assertThat(authentication.getPrincipal()).isInstanceOf(RbacBearerTokenUser.class);
    assertThat(((RbacUser) authentication.getPrincipal()).groups())
        .containsExactlyInAnyOrder("user-role", "authority-role");
  }

  private static Role role(String name, String subjectType, String value) {
    var subject = new Subject();
    subject.setProvider(Provider.OAUTH);
    subject.setType(subjectType);
    subject.setValue(value);

    var role = new Role();
    role.setName(name);
    role.setSubjects(List.of(subject));
    return role;
  }
}

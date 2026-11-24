package io.kafbat.ui.config.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.security.oauth2.resource.OAuth2ResourceServerProperties;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.web.reactive.function.client.WebClient;

class OAuthSecurityConfigTest {

  @Test
  void supportsJwtResourceServerConfiguredWithPublicKey() throws Exception {
    var keyPairGenerator = KeyPairGenerator.getInstance("RSA");
    keyPairGenerator.initialize(2048);
    var publicKey = keyPairGenerator.generateKeyPair().getPublic();
    var encodedKey = Base64.getMimeEncoder(64, new byte[] {'\n'})
        .encodeToString(publicKey.getEncoded());
    var pem = "-----BEGIN PUBLIC KEY-----\n"
        + encodedKey
        + "\n-----END PUBLIC KEY-----";

    var resourceServer = new OAuth2ResourceServerProperties();
    var jwt = resourceServer.getJwt();
    jwt.setPublicKeyLocation(new ByteArrayResource(pem.getBytes(StandardCharsets.US_ASCII)));
    var properties = new OAuthProperties();
    properties.setResourceServer(resourceServer);

    var config = new OAuthSecurityConfig(properties);
    NimbusReactiveJwtDecoder decoder = OAuthSecurityConfig.jwtDecoder(jwt, WebClient.create());

    assertThat(config.clientRegistrationRepository()).isNotNull();
    assertThat(decoder).isNotNull();
  }

  @Test
  void supportsJwtResourceServerConfiguredWithIssuer() throws Exception {
    var resourceServer = new OAuth2ResourceServerProperties();
    var jwt = resourceServer.getJwt();
    jwt.setIssuerUri("https://issuer.example");

    var properties = new OAuthProperties();
    properties.setResourceServer(resourceServer);
    var config = new OAuthSecurityConfig(properties);

    assertThat(config.clientRegistrationRepository()).isNotNull();
    assertThat(OAuthSecurityConfig.jwtDecoder(jwt, WebClient.create())).isNotNull();
  }

  @Test
  void audienceValidatorAcceptsStringAndListClaims() {
    var validator = OAuthSecurityConfig.audienceValidator(List.of("kafka-ui"));
    var stringAudience = Jwt.withTokenValue("token")
        .header("alg", "RS256")
        .claim("aud", "kafka-ui")
        .build();
    var listAudience = Jwt.withTokenValue("token")
        .header("alg", "RS256")
        .claim("aud", List.of("another-service", "kafka-ui"))
        .build();
    var unrelatedAudience = Jwt.withTokenValue("token")
        .header("alg", "RS256")
        .claim("aud", "another-service")
        .build();

    assertThat(validator.validate(stringAudience).getErrors()).isEmpty();
    assertThat(validator.validate(listAudience).getErrors()).isEmpty();
    assertThat(validator.validate(unrelatedAudience).getErrors()).isNotEmpty();
  }
}

@security
Feature: Wake-only credentials and protected application management
  # Executable coverage: scripts/test-wake-security.mjs
  Scenario: A wake token cannot gain administrative authority
    Given a member creates a wake token through OAuth
    When the token requests account settings, token creation, inbox reads or Discord posting
    Then every request is denied
    And sending a permitted wake still succeeds

  Scenario: A removed issuer loses access
    Given an enabled issuer has a token and persisted account row
    When the issuer is removed from the current allowlist
    Then both its OAuth requests and token calls are denied

  Scenario: Token expiration is enforced at the boundary
    Given a token has a configured expiry
    When the request time equals the expiry
    Then authentication is denied

  Scenario: Concurrent callers share a recipient cooldown
    Given a recipient can receive a wake
    When ten clients request that recipient concurrently
    Then only one request is admitted
    And other clients receive a rate-limit response
    And the next wake is admitted at exactly 15 seconds

  Scenario: Browser mutations and request buffers are bounded
    When a foreign-origin session sends an MCP mutation
    Then the request is denied
    When an authenticated client streams more than the byte limit
    Then reading stops and the stream is cancelled

  Scenario: Security audit excludes sensitive content
    Given token operations, rejected requests and wake deliveries occur
    Then audit rows contain action and outcome metadata
    But no message body, token, email or callback signing secret
    And storage is bounded and readable only by the OAuth owner

  @lockout-prevention
  Scenario: Migration preserves the OAuth recovery path
    Given a legacy token and configured OAuth owner exist
    When the security migration is applied
    Then the legacy token still sends wakes for a finite migration period
    And its administrative access is denied
    And the owner can create and revoke tokens through OAuth

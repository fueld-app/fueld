import { Service } from '@angular/core';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';

/**
 * PasskeyService — thin wrapper around `@simplewebauthn/browser`.
 *
 * `@simplewebauthn/browser` is a non-trivial WebAuthn client library that is
 * only used during passkey sign-in / registration / verification flows — never
 * at app boot. Encapsulating it here lets `AuthService` lazy-load this service
 * via `injectAsync(() => import('./passkey.service'), { prefetch: onIdle })`,
 * which moves `@simplewebauthn/browser` into a lazily-loaded chunk (prefetched
 * during idle time) instead of the main entry bundle.
 */
@Service()
export class PasskeyService {
  /** Trigger the browser WebAuthn prompt for sign-in/assertion. */
  startAuthentication(optionsJSON: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON> {
    return startAuthentication({ optionsJSON });
  }

  /** Trigger the browser WebAuthn prompt for credential registration/attestation. */
  startRegistration(optionsJSON: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON> {
    return startRegistration({ optionsJSON });
  }
}
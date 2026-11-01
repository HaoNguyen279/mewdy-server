# Firebase email verification

## Authentication ownership

The Expo app already creates and signs in email/password users with the Firebase Client SDK (`createUserWithEmailAndPassword` and `signInWithEmailAndPassword`). It sends the Firebase ID token to `POST /auth/firebase`; Express verifies the token with Firebase Admin and maps the Firebase UID to `users.firebase_uid`. Email/password credentials therefore remain owned by Firebase. The mobile registration flow does not write the password to PostgreSQL.

Google Sign-In, phone authentication, and the existing Firebase session behavior remain unchanged. The Express `/auth/register` and `/auth/login` handlers remain for existing backend clients, but the Expo email/password flow does not call them.

## Email verification flow

- After a new Firebase email/password account is created, the app calls Firebase Auth `sendEmailVerification` and keeps the user on a verification screen. Profile onboarding and app routes stay blocked until Firebase reports the email as verified. A failed initial send is shown to the user and can be retried from that screen.
- Signing in again with an unverified email returns to the same verification screen. Phone-only accounts and users whose Firebase email is already verified bypass the gate.
- The reminder and Settings resend action send through Firebase Auth for the currently signed-in Firebase user. Firebase applies its own delivery limits; the app also enforces a 60-second cooldown after success.
- The app does not send a client-supplied `email_verified` value. On sign-in or app resume, Express verifies the Firebase ID token, reads the current Firebase Auth user record with Admin SDK, then synchronizes the trusted `emailVerified` state into `users.email_verified` when its stored email matches the Firebase email (or no local email is stored).
- The app reloads the Firebase user when checking status and forces an ID-token refresh before backend synchronization. On returning from a browser or another device, app resume triggers the same refresh.
- Firebase's hosted email action handler processes the action code and displays Firebase's success, invalid-code, and expired-link states. The app does not parse or forward `oobCode`; it refreshes status when the user returns. This default handler also permits verification on another device without the original app session.
- `profiles.is_verified` remains separate. The app gate checks the backend's Firebase-synchronized `users.email_verified` state, and root navigation redirects unverified email accounts back to verification even if they try opening another app route.

## Configuration

The Expo app uses the Firebase client configuration in `DatingApp/.env.local` (`EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`, `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, and `EXPO_PUBLIC_FIREBASE_APP_ID`) and registers the Android app with `google-services.json`. `app.json` declares Android package `com.gooner.mewdy` and iOS bundle identifier `com.gooner.mewdy`. The client `EXPO_PUBLIC_FIREBASE_PROJECT_ID` must match the server `FIREBASE_PROJECT_ID`. Firebase Admin credentials remain server-only (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`); they let the backend validate tokens and sync status, but do not send the email. No Resend, SMTP, or email-sender variables are required on the backend.

Check in Firebase Console before release:

1. Enable Authentication > Sign-in method > Email/Password.
2. Review Authentication > Templates > Email address verification, including the sender display name and localized copy.
3. Confirm the Firebase project's authorized domains and registered Android/iOS application identifiers.
4. Check that the Firebase client API key still allows the Identity Toolkit API if API restrictions have been customized.
5. Send a real verification email from a production build and confirm the default Firebase action handler completes verification and lets the user return to Mewdy.

The current implementation intentionally uses Firebase's hosted action handler; it does not require a custom `mewdy://` verification URL, Universal Link, Android App Link, or a custom `continueUrl`. Those links should only be added if a production web domain and associated-domain configuration are chosen and tested.

## Existing accounts and data

No account migration is performed. New email/password users created in the app are Firebase users mapped to PostgreSQL by UID. Existing PostgreSQL-only password accounts are not silently created in Firebase, linked by email, or imported. A separate account-linking/migration plan is required for those users; preserve the current `password_hash` rows until that plan is chosen.

`users.email_verified` remains as the backend's synchronized representation of Firebase Auth. The existing Prisma `email_verification_tokens` model/table and historical migration are retained so already-applied deployments and stored records are not deleted or rewritten. The old token service, token endpoints, Resend sender, and client token-link flow are removed, so the retained table is no longer read or written.

No database migration is required for this replacement. Do not remove the legacy token table until its deployment state and retention requirements are reviewed separately.

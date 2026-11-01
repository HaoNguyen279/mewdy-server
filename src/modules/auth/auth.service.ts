import { OAuth2Client } from "google-auth-library";
import { hashPassword, verifyPassword } from "../users/users.service.js";
import { AuthRepository } from "./auth.repository.js";
import { FirebaseService } from "../../services/firebase.service.js";
import { invalidateAuthUserCache } from "../../middlewares/authenticate.js";
import type { LoginInput, RegisterInput } from "./auth.validation.js";
import { getTrustedProviderEmail } from "./trusted-provider-email.js";

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly firebaseService = new FirebaseService(),
    private readonly invalidateUserCache: () => Promise<void> = invalidateAuthUserCache,
  ) {}

  async register(input: RegisterInput) {
    const email = input.email?.trim().toLowerCase() ?? null;
    const phone = input.phone?.trim() ?? null;

    if (email && (await this.authRepository.findByEmail(email))) {
      throw new AuthError(409, "Email is already registered");
    }
    if (phone && (await this.authRepository.findByPhone(phone))) {
      throw new AuthError(409, "Phone number is already registered");
    }

    try {
      const user = await this.authRepository.createPasswordUser(email, phone, hashPassword(input.password));
      await this.invalidateUserCache();
      return { user };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new AuthError(409, "Email or phone number is already registered");
      }
      throw error;
    }
  }

  async login(input: LoginInput) {
    const identifier = input.identifier.trim();
    const isEmail = identifier.includes("@");
    const normalizedIdentifier = isEmail ? identifier.toLowerCase() : identifier;
    const account = isEmail
      ? await this.authRepository.findPasswordUserByEmail(normalizedIdentifier)
      : await this.authRepository.findPasswordUserByPhone(normalizedIdentifier);

    if (!account?.password_hash || !verifyPassword(input.password, account.password_hash)) {
      throw new AuthError(401, "Invalid email/phone or password");
    }
    if (account.status !== "active") {
      throw new AuthError(403, "This account is not active");
    }

    return { user: await this.authRepository.recordSignIn(account.id) };
  }

  async signInWithGoogle(idToken: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new AuthError(500, "Google Sign-In is not configured on the server");
    }

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new AuthError(401, "Invalid or expired Google ID token");
    }

    if (!payload?.sub) {
      throw new AuthError(401, "Invalid Google ID token");
    }

    const googleSub = payload.sub;
    const email = getTrustedProviderEmail(payload.email, payload.email_verified);

    const existingUser = await this.authRepository.findByGoogleSub(googleSub);
    if (existingUser) {
      if (existingUser.status !== "active") {
        throw new AuthError(403, "This account is not active");
      }

      return {
        user: await this.authRepository.recordSignIn(existingUser.id, email),
        isNewUser: false,
      };
    }

    try {
      const user = await this.authRepository.createGoogleUser(googleSub, email, Boolean(email));
      await this.invalidateUserCache();
      return { user, isNewUser: true };
    } catch (error) {
      // A concurrent first sign-in may have inserted this Google sub after our lookup.
      let userCreatedByConcurrentRequest = await this.authRepository.findByGoogleSub(googleSub);

      // The database may enforce unique emails for existing password accounts. Keep Google
      // identity keyed by sub instead of silently linking it to an account by email.
      if (!userCreatedByConcurrentRequest && email && this.isUniqueConstraintError(error)) {
        try {
          const user = await this.authRepository.createGoogleUser(googleSub, null, false);
          await this.invalidateUserCache();
          return { user, isNewUser: true };
        } catch (retryError) {
          userCreatedByConcurrentRequest = await this.authRepository.findByGoogleSub(googleSub);
          if (!userCreatedByConcurrentRequest) {
            throw retryError;
          }
        }
      }

      if (!userCreatedByConcurrentRequest) throw error;

      if (userCreatedByConcurrentRequest.status !== "active") {
        throw new AuthError(403, "This account is not active");
      }

      return {
        user: await this.authRepository.recordSignIn(userCreatedByConcurrentRequest.id, email),
        isNewUser: false,
      };
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
  }

  async signInWithFirebase(idToken: string) {
    if (!this.firebaseService.isConfigured()) {
      throw new AuthError(500, "Firebase is not configured on the server");
    }

    let decodedToken;
    try {
      decodedToken = await this.firebaseService.verifyIdToken(idToken);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Firebase")) {
        throw error;
      }
      throw new AuthError(401, "Invalid or expired Firebase ID token");
    }

    const firebaseUid = decodedToken.uid;
    let firebaseUser;
    try {
      // ID token claims can be stale after a user verifies their email. Read the current
      // Firebase Auth record so PostgreSQL mirrors Firebase's authoritative state.
      firebaseUser = await this.firebaseService.getUser(firebaseUid);
    } catch {
      throw new AuthError(401, "Firebase account could not be loaded");
    }
    const email = firebaseUser.email?.trim().toLowerCase() || null;
    const emailVerified = Boolean(email && firebaseUser.emailVerified);

    const existingUser = await this.authRepository.findByFirebaseUid(firebaseUid);
    if (existingUser) {
      if (existingUser.status !== "active") {
        throw new AuthError(403, "This account is not active");
      }

      const user = await this.authRepository.recordFirebaseSignIn(existingUser.id, email, emailVerified);
      if (!user) throw new AuthError(404, "Firebase account is not linked to a dating account");
      return {
        user,
        isNewUser: false,
      };
    }

    try {
      const user = await this.authRepository.createFirebaseUser(firebaseUid, email, emailVerified);
      await this.invalidateUserCache();
      return { user, isNewUser: true };
    } catch (error) {
      // A concurrent first sign-in may have inserted this Firebase UID after our lookup.
      let userCreatedByConcurrentRequest = await this.authRepository.findByFirebaseUidFromDatabase(firebaseUid);

      // The database may enforce unique emails for existing password accounts. Keep Firebase
      // identity keyed by UID instead of silently linking it to an account by email.
      if (!userCreatedByConcurrentRequest && email && this.isUniqueConstraintError(error)) {
        try {
          const user = await this.authRepository.createFirebaseUser(firebaseUid, null, emailVerified);
          await this.invalidateUserCache();
          return { user, isNewUser: true };
        } catch (retryError) {
          userCreatedByConcurrentRequest = await this.authRepository.findByFirebaseUidFromDatabase(firebaseUid);
          if (!userCreatedByConcurrentRequest) {
            throw retryError;
          }
        }
      }

      if (!userCreatedByConcurrentRequest) throw error;

      if (userCreatedByConcurrentRequest.status !== "active") {
        throw new AuthError(403, "This account is not active");
      }

      const user = await this.authRepository.recordFirebaseSignIn(
        userCreatedByConcurrentRequest.id,
        email,
        emailVerified,
      );
      if (!user) throw new AuthError(404, "Firebase account is not linked to a dating account");
      return {
        user,
        isNewUser: false,
      };
    }
  }

  async syncPhoneVerification(idToken: string) {
    let decodedToken;
    try {
      decodedToken = await this.firebaseService.verifyIdToken(idToken);
    } catch {
      throw new AuthError(401, "Invalid or expired Firebase ID token");
    }

    const firebaseUser = await this.firebaseService.getUser(decodedToken.uid);
    if (!firebaseUser.phoneNumber) {
      throw new AuthError(400, "A verified phone number is not linked to this Firebase account");
    }

    const profileUpdated = await this.authRepository.setProfileVerifiedByFirebaseUid(
      decodedToken.uid,
      true,
    );
    if (!profileUpdated) {
      throw new AuthError(404, "Profile not found for this Firebase account");
    }

    return { is_verified: true };
  }

  async createNativePhoneSession(idToken: string) {
    let decodedToken;
    try {
      decodedToken = await this.firebaseService.verifyIdToken(idToken);
    } catch {
      throw new AuthError(401, "Invalid or expired Firebase ID token");
    }

    const account = await this.authRepository.findByFirebaseUid(decodedToken.uid);
    if (!account || account.status !== "active") {
      throw new AuthError(403, "A signed-in Firebase account is required");
    }

    const customToken = await this.firebaseService.createCustomToken(decodedToken.uid);
    return { customToken };
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import { AuthRepository } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";
import { FirebaseService } from "../../services/firebase.service.js";

test("Firebase Auth user record overrides a stale email_verified ID token claim", async () => {
  const recordedStatuses: boolean[] = [];
  const repository = {
    findByFirebaseUid: async () => ({ id: "user-1", status: "active" }),
    recordFirebaseSignIn: async (_id: string, _email: string, verified: boolean) => {
      recordedStatuses.push(verified);
      return { id: "user-1", email_verified: verified };
    },
  } as unknown as AuthRepository;
  const firebaseService = {
    isConfigured: () => true,
    verifyIdToken: async () => ({ uid: "firebase-1", email_verified: false }),
    getUser: async () => ({ email: "person@example.com", emailVerified: true }),
  } as unknown as FirebaseService;
  const service = new AuthService(repository, firebaseService, async () => undefined);

  const result = await service.signInWithFirebase("valid-id-token");

  assert.ok(result.user);
  assert.deepEqual(recordedStatuses, [true]);
  assert.equal(result.user.email_verified, true);
  assert.equal(result.isNewUser, false);
});

test("Firebase Auth user record keeps an unverified email unverified", async () => {
  const recordedStatuses: boolean[] = [];
  const repository = {
    findByFirebaseUid: async () => ({ id: "user-1", status: "active" }),
    recordFirebaseSignIn: async (_id: string, _email: string, verified: boolean) => {
      recordedStatuses.push(verified);
      return { id: "user-1", email_verified: verified };
    },
  } as unknown as AuthRepository;
  const firebaseService = {
    isConfigured: () => true,
    verifyIdToken: async () => ({ uid: "firebase-1", email_verified: true }),
    getUser: async () => ({ email: "person@example.com", emailVerified: false }),
  } as unknown as FirebaseService;
  const service = new AuthService(repository, firebaseService, async () => undefined);

  const result = await service.signInWithFirebase("valid-id-token");

  assert.ok(result.user);
  assert.deepEqual(recordedStatuses, [false]);
  assert.equal(result.user.email_verified, false);
});

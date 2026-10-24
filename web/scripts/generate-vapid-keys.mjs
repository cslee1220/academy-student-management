import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("WEB_PUSH_VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log("WEB_PUSH_VAPID_SUBJECT=mailto:admin@example.com");

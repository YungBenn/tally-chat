import { expect, test } from "vitest";
import { reachable } from "./backendUrl";

test("a loopback backend URL takes the page's host when the page is opened from elsewhere", () => {
  expect(reachable("http://127.0.0.1:3210", "100.126.169.55")).toBe("http://100.126.169.55:3210");
  expect(reachable("http://127.0.0.1:3210/api/storage/abc?x=1", "laptop.tail1234.ts.net")).toBe(
    "http://laptop.tail1234.ts.net:3210/api/storage/abc?x=1",
  );
  // On the machine itself, on the server, and for real hosts: unchanged.
  expect(reachable("http://127.0.0.1:3210", "localhost")).toBe("http://127.0.0.1:3210");
  expect(reachable("http://127.0.0.1:3210", undefined)).toBe("http://127.0.0.1:3210");
  expect(reachable("https://convex.example.com", "100.126.169.55")).toBe("https://convex.example.com");
});

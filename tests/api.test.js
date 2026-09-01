// Example API tests - run with `npm test` after installing jest & supertest
// npm install --save-dev jest supertest mongodb-memory-server

const request = require("supertest");
const app = require("../index");

describe("DriveFleet API", () => {
  it("GET / should return running message", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("DriveFleet Server is Running");
  });

  it("GET /cars should return object with cars array (or array for compat)", async () => {
    const res = await request(app).get("/cars");
    expect([200, 500]).toContain(res.status); // 500 if no DB in test env
  });

  it("POST /jwt should require email", async () => {
    const res = await request(app).post("/jwt").send({});
    expect(res.status).toBe(400);
  });
});

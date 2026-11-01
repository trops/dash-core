import {
  pictureReason,
  pictureReasonText,
  notePictureFailed,
  notePictureLoaded,
  noteBlocked,
  pictureProblemsFor,
  clearPictureProblems,
  subscribePictures,
  installPictureWatch,
  _resetPictures,
} from "./pictureProblems";

const LINK =
  "http://10.0.0.107/api/media_player_proxy/media_player.living_room?token=abc";

beforeEach(() => _resetPictures());

describe("why a picture failed", () => {
  test("a src that isn't a web address", () => {
    expect(pictureReason("http//10.0.0.107/api/x")).toBe("not-address");
    expect(pictureReason("/api/media_player_proxy/x")).toBe("not-address");
    expect(pictureReason("https//x.com/a.png")).toBe("not-address");
  });
  test("a web address Dash blocked, or one that just failed", () => {
    expect(pictureReason(LINK, LINK, true)).toBe("blocked");
    expect(pictureReason(LINK, LINK)).toBe("failed");
    expect(pictureReason("data:image/png;base64,xx")).toBe("failed");
  });
  test("the words say what to fix", () => {
    expect(pictureReasonText("not-address", "http//10.0.0.107/a")).toMatch(
      /missing ":" after http/,
    );
    expect(pictureReasonText("not-address", "/api/a")).toMatch(
      /no server address in front/,
    );
    expect(pictureReasonText("blocked", LINK)).toMatch(/Dash blocked it/);
    expect(pictureReasonText("failed", LINK)).toMatch(/wasn't found/);
  });
});

describe("a copy's problems", () => {
  test("the exact address as written when it isn't a web address", () => {
    notePictureFailed(
      "u-1",
      "http//10.0.0.107/api/x?token=1",
      "file:///app/http//10.0.0.107/api/x?token=1",
    );
    expect(pictureProblemsFor("u-1")).toEqual([
      expect.objectContaining({
        address: "http//10.0.0.107/api/x?token=1",
        reason: "not-address",
      }),
    ]);
  });
  test("a web address as resolved; once each; a load clears it", () => {
    const heard = jest.fn();
    subscribePictures(heard);
    notePictureFailed("u-1", LINK, LINK);
    notePictureFailed("u-1", LINK, LINK);
    expect(pictureProblemsFor("u-1")).toHaveLength(1);
    expect(heard).toHaveBeenCalledTimes(1);
    notePictureLoaded("u-1", LINK, LINK);
    expect(pictureProblemsFor("u-1")).toEqual([]);
  });
  test("a block reported after the error turns it into 'blocked'", () => {
    notePictureFailed("u-1", LINK, LINK);
    noteBlocked(LINK);
    expect(pictureProblemsFor("u-1")[0].reason).toBe("blocked");
  });
  test("one copy's problems aren't another's; clear forgets them", () => {
    notePictureFailed("u-1", LINK, LINK);
    expect(pictureProblemsFor("u-2")).toEqual([]);
    clearPictureProblems("u-1");
    expect(pictureProblemsFor("u-1")).toEqual([]);
  });
});

describe("watching the window", () => {
  test("a broken picture inside a widget's box is that copy's", () => {
    installPictureWatch(window);
    const box = document.createElement("div");
    box.setAttribute("data-widget-key", "ai-built.player");
    box.setAttribute("data-widget-uuid", "u-9");
    const img = document.createElement("img");
    img.setAttribute("src", "http//10.0.0.107/cover.jpg");
    box.appendChild(img);
    document.body.appendChild(box);
    img.dispatchEvent(new Event("error"));
    expect(pictureProblemsFor("u-9")).toEqual([
      expect.objectContaining({
        address: "http//10.0.0.107/cover.jpg",
        reason: "not-address",
      }),
    ]);
    const outside = document.createElement("img");
    outside.setAttribute("src", "/x.png");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("error"));
    expect(pictureProblemsFor("ai-built.player")).toEqual([]);
    box.remove();
    outside.remove();
  });
});

import { describe, expect, it } from "vitest";
import { moveTool, orderedToolIds } from "./toolbarOrder";

describe("toolbar layout on iPhone", () => {
  it("reorders user buttons without losing a newly introduced action", () => {
    expect(orderedToolIds(["excluir","texto","dividir","velocidade"], ["velocidade","texto","excluir"]))
      .toEqual(["velocidade","texto","excluir","dividir"]);
  });
  it("moves a held tool to the desired position and keeps unrelated actions", () => {
    expect(moveTool(["Excluir","Texto","Dividir","Volume"], "Volume", "Excluir"))
      .toEqual(["Volume","Excluir","Texto","Dividir"]);
    expect(moveTool(["Excluir","Texto"], "missing", "Excluir")).toEqual(["Excluir","Texto"]);
  });
  it("uses original order for tools that have never been customized", () => {
    expect(orderedToolIds(["Editar","Áudio","Texto"], [])).toEqual(["Editar","Áudio","Texto"]);
  });
});

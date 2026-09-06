import { create } from "zustand";
import type { Tool } from "../types";

interface EditorState {
  tool: Tool;
  zoom: number;
  gridVisible: boolean;
  selectedColor: number;
  setTool: (tool: Tool) => void;
  setZoom: (zoom: number) => void;
  toggleGrid: () => void;
  setSelectedColor: (index: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: "pencil",
  zoom: 12,
  gridVisible: true,
  selectedColor: 1,
  setTool: (tool) => set({ tool }),
  setZoom: (zoom) => set({ zoom }),
  toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),
  setSelectedColor: (selectedColor) => set({ selectedColor }),
}));

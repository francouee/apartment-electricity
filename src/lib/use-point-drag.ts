import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { positionSchema, type Position } from "./model";

export function clientToPlan(
  svg: SVGSVGElement, group: SVGGElement, clientX: number, clientY: number,
  offset = { x: 0, y: 0 },
): Position | null {
  const bounds = svg.getBoundingClientRect();
  if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return null;
  const matrix = group.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  const parsed = positionSchema.safeParse({ x: point.x / 20 - offset.x, y: point.y / 20 - offset.y });
  return parsed.success ? parsed.data : null;
}

type DragEvent = ReactPointerEvent<HTMLElement | SVGElement>;
type Gesture = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  offset: Position;
  active: boolean;
  element: HTMLElement | SVGElement;
};

export function usePointDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  groupRef: RefObject<SVGGElement | null>,
  callbacks: {
    disabled: boolean;
    onStart: (id: string) => void;
    onDrop: (id: string, position: Position) => void;
    onCancel: () => void;
  },
) {
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const gesture = useRef<Gesture | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; position: Position } | null>(null);
  const suppressedClick = useRef<string | null>(null);
  const scrollFrame = useRef<number | null>(null);

  function clear() {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    const current = gesture.current;
    gesture.current = null;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    setDraggingId(null);
    setPreview(null);
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  }

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !gesture.current) return;
      const current = gesture.current;
      if (current.active) suppressedClick.current = current.id;
      clear();
      latest.current.onCancel();
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      const current = gesture.current;
      gesture.current = null;
      if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    };
  }, []);

  function start(event: DragEvent, id: string, originalPosition: Position | null) {
    if (latest.current.disabled || gesture.current || event.button !== 0 || !event.isPrimary) return;
    const svg = svgRef.current;
    const group = groupRef.current;
    if (!svg || !group) return;
    const anchor = originalPosition ? clientToPlan(svg, group, event.clientX, event.clientY) : null;
    suppressedClick.current = null;
    gesture.current = {
      id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      clientX: event.clientX, clientY: event.clientY,
      offset: anchor && originalPosition ? { x: anchor.x - originalPosition.x, y: anchor.y - originalPosition.y } : { x: 0, y: 0 },
      active: false, element: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }

  function updatePreview(current: Gesture) {
    const svg = svgRef.current;
    const group = groupRef.current;
    const position = svg && group ? clientToPlan(svg, group, current.clientX, current.clientY, current.offset) : null;
    setPreview(position ? { id: current.id, position } : null);
  }

  function autoScroll() {
    const current = gesture.current;
    if (!current?.active) return;
    const edge = 60;
    const speed = current.clientY < edge ? -12 : current.clientY > window.innerHeight - edge ? 12 : 0;
    if (speed) {
      window.scrollBy(0, speed);
      updatePreview(current);
    }
    scrollFrame.current = requestAnimationFrame(autoScroll);
  }

  function move(event: DragEvent) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.active && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4) return;
    if (!current.active) {
      current.active = true;
      setDraggingId(current.id);
      latest.current.onStart(current.id);
      scrollFrame.current = requestAnimationFrame(autoScroll);
    }
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    event.preventDefault();
    updatePreview(current);
  }

  function finish(event: DragEvent) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const svg = svgRef.current;
    const group = groupRef.current;
    const position = svg && group ? clientToPlan(svg, group, event.clientX, event.clientY, current.offset) : null;
    if (current.active) suppressedClick.current = current.id;
    clear();
    if (!current.active) return;
    if (position && !latest.current.disabled) latest.current.onDrop(current.id, position);
    else latest.current.onCancel();
  }

  function cancel() {
    if (!gesture.current) return;
    clear();
    latest.current.onCancel();
  }

  function consumeClick(id: string, detail: number) {
    if (detail === 0 || suppressedClick.current !== id) return false;
    suppressedClick.current = null;
    return true;
  }

  return {
    draggingId, preview, start, move, finish, cancel, consumeClick,
    isEngaged: () => gesture.current !== null,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  ADDITION,
  Brush,
  Evaluator,
  INTERSECTION,
  SUBTRACTION,
} from "three-bvh-csg";
import {
  Box,
  BoxSelect,
  Check,
  ChevronDown,
  Circle,
  Cone,
  Copy,
  Cuboid,
  Download,
  Eye,
  EyeOff,
  Grid3X3,
  Layers,
  Maximize2,
  Minus,
  Move3d,
  Pencil,
  Plus,
  Redo2,
  Rotate3d,
  Save,
  Scissors,
  Settings2,
  Shapes,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Ungroup,
  X,
} from "lucide-react";
import { toast } from "sonner";

const LIMIT = 300;
const STORAGE_KEY = "modela3d-project";

type ShapeType = "box" | "cylinder" | "sphere" | "cone" | "prism" | "screw" | "nut" | "path" | "boolean";
type ToolMode = "translate" | "rotate" | "scale";
type BooleanMode = "union" | "subtract" | "intersect";
type ComponentRole = "conduit" | "lockPin" | "counterLock";
type Vec3 = [number, number, number];

type GeometryData = {
  positions: number[];
  indices?: number[];
};

type FaceContour = {
  start: Vec3;
  end: Vec3;
};

type ModelObject = {
  id: string;
  name: string;
  type: ShapeType;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  dimensions: Vec3;
  color: string;
  groupId?: string;
  componentRole?: ComponentRole;
  anchorTo?: string;
  filletRadius?: number;
  pathPoints?: Vec3[];
  openFace?: { axis: 0 | 1 | 2; sign: 1 | -1 };
  visible: boolean;
  geometryData?: GeometryData;
};

const COLORS = ["#5fe1be", "#ffb86b", "#7aa7ff", "#f285b5", "#c5a7ff"];

const typeLabels: Record<ShapeType, string> = {
  box: "Cubo",
  cylinder: "Cilindro",
  sphere: "Esfera",
  cone: "Cone",
  prism: "Prisma",
  screw: "Parafuso",
  nut: "Porca",
  path: "Caminho seguido",
  boolean: "Sólido combinado",
};

const componentLabels: Record<ComponentRole, string> = {
  conduit: "Conduto",
  lockPin: "Pino macho",
  counterLock: "Trava fêmea",
};

const componentColors: Record<ComponentRole, string> = {
  conduit: "#f2c76e",
  lockPin: "#ff8f9b",
  counterLock: "#9e9bff",
};

const toolLabels: Record<ToolMode, string> = {
  translate: "Mover",
  rotate: "Rotacionar",
  scale: "Escalar",
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function cloneObjects(items: ModelObject[]) {
  return JSON.parse(JSON.stringify(items)) as ModelObject[];
}

function createModel(
  type: Exclude<ShapeType, "boolean">,
  index: number,
): ModelObject {
  const defaults: Record<Exclude<ShapeType, "boolean">, Vec3> = {
    box: [60, 40, 60],
    cylinder: [50, 60, 50],
    sphere: [50, 50, 50],
    cone: [60, 70, 60],
    prism: [60, 65, 60],
    screw: [16, 60, 16],
    nut: [24, 14, 24],
    path: [8, 8, 8],
  };
  const position: Vec3 = [index * 18 - 18, defaults[type][1] / 2, 0];
  return {
    id: uid(),
    name: `${typeLabels[type]} ${index + 1}`,
    type,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    dimensions: defaults[type],
    color: COLORS[index % COLORS.length],
    visible: true,
  };
}

function componentHeight(role: ComponentRole) {
  return role === "conduit" ? 42 : role === "lockPin" ? 28 : 18;
}

function createComponent(
  role: ComponentRole,
  host: ModelObject,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
): ModelObject {
  const diameter = role === "conduit" ? 16 : role === "lockPin" ? 10 : 14;
  return {
    id: uid(),
    name: `${componentLabels[role]} · ${host.name}`,
    type: "cylinder",
    position,
    rotation,
    scale: [1, 1, 1],
    dimensions: [diameter, componentHeight(role), diameter],
    color: componentColors[role],
    componentRole: role,
    anchorTo: host.id,
    visible: true,
  };
}

function modelLabel(model: ModelObject) {
  return model.componentRole ? componentLabels[model.componentRole] : typeLabels[model.type];
}

function makeTubeGeometry(outerRadius: number, height: number, wall: number, segments = 48) {
  const innerRadius = Math.max(outerRadius - wall, outerRadius * 0.35);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    positions.push(
      cos * outerRadius, -height / 2, sin * outerRadius,
      cos * outerRadius, height / 2, sin * outerRadius,
      cos * innerRadius, -height / 2, sin * innerRadius,
      cos * innerRadius, height / 2, sin * innerRadius,
    );
  }
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const outerBottom = index * 4;
    const outerTop = outerBottom + 1;
    const innerBottom = outerBottom + 2;
    const innerTop = outerBottom + 3;
    const nextOuterBottom = next * 4;
    const nextOuterTop = nextOuterBottom + 1;
    const nextInnerBottom = nextOuterBottom + 2;
    const nextInnerTop = nextOuterBottom + 3;
    indices.push(
      outerBottom, nextOuterBottom, outerTop, nextOuterBottom, nextOuterTop, outerTop,
      innerBottom, innerTop, nextInnerBottom, nextInnerBottom, innerTop, nextInnerTop,
      outerTop, nextOuterTop, innerTop, nextOuterTop, nextInnerTop, innerTop,
      outerBottom, innerBottom, nextOuterBottom, nextOuterBottom, innerBottom, nextInnerBottom,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeOpenBoxGeometry(width: number, height: number, depth: number, openFace: { axis: 0 | 1 | 2; sign: 1 | -1 }) {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const faces: Array<{ axis: 0 | 1 | 2; sign: 1 | -1; corners: Vec3[] }> = [
    { axis: 0, sign: 1, corners: [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]] },
    { axis: 0, sign: -1, corners: [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]] },
    { axis: 1, sign: 1, corners: [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]] },
    { axis: 1, sign: -1, corners: [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]] },
    { axis: 2, sign: 1, corners: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]] },
    { axis: 2, sign: -1, corners: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]] },
  ];
  const positions: number[] = [];
  faces.filter((face) => face.axis !== openFace.axis || face.sign !== openFace.sign).forEach((face) => {
    face.corners.forEach((corner) => positions.push(...corner));
  });
  const indices: number[] = [];
  for (let faceIndex = 0; faceIndex < positions.length / 12; faceIndex += 1) {
    const base = faceIndex * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeGeometry(model: ModelObject) {
  if (model.type === "boolean" && model.geometryData) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(model.geometryData.positions, 3),
    );
    if (model.geometryData.indices) {
      geometry.setIndex(model.geometryData.indices);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  const [width, height, depth] = model.dimensions;
  if (model.type === "path" && model.pathPoints && model.pathPoints.length > 1) {
    const curve = new THREE.CatmullRomCurve3(model.pathPoints.map((point) => new THREE.Vector3(...point)));
    return new THREE.TubeGeometry(curve, Math.max(12, model.pathPoints.length * 12), Math.max(0.5, width / 2), 16, false);
  }
  if (model.componentRole === "counterLock") {
    return makeTubeGeometry(width / 2, height, Math.min(2.2, width / 5));
  }
  switch (model.type) {
    case "cylinder":
      return new THREE.CylinderGeometry(width / 2, width / 2, height, 48);
    case "sphere":
      return new THREE.SphereGeometry(0.5, 48, 32).scale(width, height, depth);
    case "cone":
      return new THREE.ConeGeometry(width / 2, height, 48);
    case "prism":
      return new THREE.CylinderGeometry(width / 2, width / 2, height, 6);
    case "screw": {
      const headHeight = Math.min(8, height * 0.2);
      const shaft = new THREE.CylinderGeometry(width * 0.34, width * 0.34, Math.max(1, height - headHeight), 32);
      shaft.translate(0, -headHeight / 2, 0);
      const head = new THREE.CylinderGeometry(width / 2, width / 2, headHeight, 6);
      head.translate(0, height / 2 - headHeight / 2, 0);
      return mergeGeometries([shaft, head], false) ?? shaft;
    }
    case "nut":
      return makeTubeGeometry(width / 2, height, Math.min(width * 0.22, width / 2 - 0.5), 6);
    case "box":
    default:
      if (model.openFace) return makeOpenBoxGeometry(width, height, depth, model.openFace);
      if (model.filletRadius && model.filletRadius > 0) {
        const radius = Math.min(model.filletRadius, Math.max(0, Math.min(width, height, depth) / 2 - 0.1));
        return new RoundedBoxGeometry(width, height, depth, 5, radius);
      }
      return new THREE.BoxGeometry(width, height, depth);
  }
}

function modelMatrix(model: ModelObject) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...model.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(model.rotation[0]),
      THREE.MathUtils.degToRad(model.rotation[1]),
      THREE.MathUtils.degToRad(model.rotation[2]),
    )),
    new THREE.Vector3(...model.scale),
  );
}

function worldBounds(model: ModelObject) {
  const geometry = makeGeometry(model);
  geometry.applyMatrix4(modelMatrix(model));
  geometry.computeBoundingBox();
  return geometry.boundingBox ?? new THREE.Box3();
}

function geometryForBrush(model: ModelObject) {
  const geometry = makeGeometry(model);
  const brush = new Brush(geometry, new THREE.MeshStandardMaterial({ color: model.color }));
  brush.position.set(...model.position);
  brush.rotation.set(
    THREE.MathUtils.degToRad(model.rotation[0]),
    THREE.MathUtils.degToRad(model.rotation[1]),
    THREE.MathUtils.degToRad(model.rotation[2]),
  );
  brush.scale.set(...model.scale);
  brush.updateMatrixWorld(true);
  return brush;
}

function serializeWorldGeometry(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) {
  const world = geometry.clone();
  world.applyMatrix4(matrix);
  const position = world.getAttribute("position");
  const index = world.getIndex();
  world.computeBoundingBox();
  const box = world.boundingBox ?? new THREE.Box3();
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  return {
    data: {
      positions: Array.from(position.array as ArrayLike<number>),
      indices: index ? Array.from(index.array as ArrayLike<number>) : undefined,
    },
    dimensions: [round(size.x), round(size.y), round(size.z)] as Vec3,
    center: [round(center.x), round(center.y), round(center.z)] as Vec3,
  };
}

function contourFrame(contour: FaceContour, face: { normal: Vec3; tangent: Vec3 }) {
  const start = new THREE.Vector3(...contour.start);
  const end = new THREE.Vector3(...contour.end);
  const tangent = new THREE.Vector3(...face.tangent).normalize();
  const normal = new THREE.Vector3(...face.normal).normalize();
  const bitangent = normal.clone().cross(tangent).normalize();
  const delta = end.clone().sub(start);
  const width = Math.max(1, Math.abs(delta.dot(tangent)));
  const height = Math.max(1, Math.abs(delta.dot(bitangent)));
  const center = start.clone().add(end).multiplyScalar(0.5);
  return { center, tangent, bitangent, normal, width, height };
}

function inputValue(event: React.ChangeEvent<HTMLInputElement>) {
  const value = Number(event.target.value);
  return Number.isFinite(value) ? value : 0;
}

function Field({
  label,
  value,
  onChange,
  suffix = "mm",
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-input">
        <input
          type="number"
          step="0.1"
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => onChange(inputValue(event))}
          disabled={disabled}
        />
        <small>{suffix}</small>
      </div>
    </label>
  );
}

function IconButton({
  label,
  onClick,
  children,
  active = false,
  disabled = false,
  danger = false,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${danger ? "danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export default function Home() {
  const initialModelRef = useRef<ModelObject | null>(null);
  if (!initialModelRef.current) initialModelRef.current = createModel("box", 0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const meshMapRef = useRef(new Map<string, THREE.Group>());
  const selectionHelperRef = useRef<THREE.BoxHelper | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const objectsRef = useRef<ModelObject[]>([]);
  const historyRef = useRef<ModelObject[][]>([]);
  const redoRef = useRef<ModelObject[][]>([]);
  const transformHistoryStartedRef = useRef(false);
  const [objects, setObjects] = useState<ModelObject[]>(() => [initialModelRef.current!]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => [initialModelRef.current!.id]);
  const [tool, setTool] = useState<ToolMode>("translate");
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [view, setView] = useState<"perspective" | "top">("perspective");
  const [autoAnchor, setAutoAnchor] = useState(true);
  const [autoClick, setAutoClick] = useState(false);
  const [placementRole, setPlacementRole] = useState<ComponentRole>("conduit");
  const [pushPullAmount, setPushPullAmount] = useState(10);
  const [wallThickness, setWallThickness] = useState(3);
  const [filletPercent, setFilletPercent] = useState(20);
  const [inspectInterior, setInspectInterior] = useState(false);
  const [faceMode, setFaceMode] = useState(false);
  const [faceSelection, setFaceSelection] = useState<{ id: string; axis: 0 | 1 | 2; sign: 1 | -1; point: Vec3; normal: Vec3; tangent: Vec3 } | null>(null);
  const [holeDiameter, setHoleDiameter] = useState(10);
  const [faceContour, setFaceContour] = useState<FaceContour | null>(null);
  const [drawingContour, setDrawingContour] = useState(false);
  const contourStartRef = useRef<THREE.Vector3 | null>(null);
  const [draggingFace, setDraggingFace] = useState(false);
  const faceDragRef = useRef<{ id: string; axis: 0 | 1 | 2; sign: 1 | -1; startY: number; baseObjects: ModelObject[] } | null>(null);
  const [pathMode, setPathMode] = useState(false);
  const [pathPoints, setPathPoints] = useState<Vec3[]>([]);
  const [pathRadius, setPathRadius] = useState(4);
  const [, setTransformTick] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const restored = JSON.parse(stored) as ModelObject[];
      if (!Array.isArray(restored) || restored.length === 0) return;
      setObjects(restored);
      setSelectedIds([restored[0].id]);
      setSaved(true);
      toast.success("Projeto salvo restaurado");
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const activeId = selectedIds[0];
  const active = objects.find((item) => item.id === activeId);
  const activeDimensions = active?.dimensions ?? [0, 0, 0];
  const activePosition = active?.position ?? [0, 0, 0];
  const activeRotation = active?.rotation ?? [0, 0, 0];
  const activeScale = active?.scale ?? [1, 1, 1];

  const invalidIds = useMemo(() => {
    return new Set(
      objects
        .filter((item) => {
          const bounds = worldBounds(item);
          return bounds.min.x < -LIMIT / 2 || bounds.max.x > LIMIT / 2 || bounds.min.y < -LIMIT / 2 || bounds.max.y > LIMIT / 2 || bounds.min.z < -LIMIT / 2 || bounds.max.z > LIMIT / 2;
        })
        .map((item) => item.id),
    );
  }, [objects]);

  const validation = useMemo(() => {
    if (objects.length === 0) return { tone: "empty", label: "Cena vazia", detail: "Adicione um sólido para começar." };
    if (invalidIds.size > 0) return { tone: "warning", label: "Ajustes necessários", detail: `${invalidIds.size} objeto(s) excedem o limite de 300 mm.` };
    if (objects.some((item) => item.type === "boolean" && !item.geometryData)) return { tone: "warning", label: "Geometria incompleta", detail: "Revise os sólidos combinados antes de exportar." };
    return { tone: "success", label: "Pronto para fatiar", detail: "Todos os objetos estão dentro da caixa de 300 mm." };
  }, [invalidIds, objects]);

  const snapshot = useCallback(() => cloneObjects(objectsRef.current), []);

  const commit = useCallback((next: ModelObject[], withHistory = true) => {
    if (withHistory) historyRef.current.push(snapshot());
    redoRef.current = [];
    setObjects(next);
    setSaved(false);
  }, [snapshot]);

  const updateModel = useCallback((id: string, patch: Partial<ModelObject>) => {
    commit(objectsRef.current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, [commit]);

  const updatePositionWithAnchors = useCallback((id: string, nextPosition: Vec3) => {
    const current = objectsRef.current.find((item) => item.id === id);
    if (!current) return;
    const delta = nextPosition.map((value, index) => value - current.position[index]) as Vec3;
    commit(objectsRef.current.map((item) => {
      if (item.id === id) return { ...item, position: nextPosition };
      if (item.anchorTo !== id) return item;
      return { ...item, position: item.position.map((value, index) => round(value + delta[index])) as Vec3 };
    }));
  }, [commit]);

  const updateVector = useCallback((id: string, key: "position" | "rotation" | "scale" | "dimensions", index: number, value: number) => {
    const current = objectsRef.current.find((item) => item.id === id);
    if (!current) return;
    const nextVector = [...current[key]] as Vec3;
    nextVector[index] = value;
    if (key === "position") updatePositionWithAnchors(id, nextVector);
    else updateModel(id, { [key]: nextVector } as Partial<ModelObject>);
  }, [updateModel, updatePositionWithAnchors]);

  const applyPushPull = useCallback((forcedAmount?: number) => {
    if (!active) {
      toast.info("Selecione uma peça para usar Puxar/empurrar");
      return;
    }
    if (active.type === "boolean") {
      toast.info("Puxar/empurrar funciona em peças primitivas");
      return;
    }
    const selectedFace = faceSelection?.id === active.id ? faceSelection : null;
    const amount = forcedAmount ?? pushPullAmount;
    const axis = selectedFace?.axis ?? 1;
    const sign = selectedFace?.sign ?? 1;
    const nextDimensions = [...active.dimensions] as Vec3;
    nextDimensions[axis] = Math.max(1, round(nextDimensions[axis] + amount));
    const dimensionDelta = nextDimensions[axis] - active.dimensions[axis];
    const nextPosition = [...active.position] as Vec3;
    nextPosition[axis] = round(nextPosition[axis] + sign * dimensionDelta / 2);
    commit(objectsRef.current.map((item) => {
      if (item.id === active.id) return { ...item, dimensions: nextDimensions, position: nextPosition };
      if (item.anchorTo !== active.id) return item;
      return { ...item, position: item.position.map((value, index) => round(value + (index === axis ? sign * dimensionDelta / 2 : 0))) as Vec3 };
    }));
    toast.success(`${amount >= 0 ? "Puxado" : "Recuado"} ${Math.abs(amount)} mm${selectedFace ? ` no eixo ${["X", "Y", "Z"][axis]}` : ""}`);
  }, [active, commit, faceSelection, pushPullAmount]);

  const deleteFace = useCallback(() => {
    if (!active || !faceSelection || faceSelection.id !== active.id) {
      toast.info("Selecione uma face primeiro");
      return;
    }
    if (active.type !== "box") {
      toast.info("Deletar face está disponível para cubos nesta versão");
      return;
    }
    updateModel(active.id, { openFace: { axis: faceSelection.axis, sign: faceSelection.sign }, filletRadius: undefined });
    toast.success("Face deletada: peça aberta");
  }, [active, faceSelection, updateModel]);

  const drillFace = useCallback(() => {
    if (!active || !faceSelection || faceSelection.id !== active.id) {
      toast.info("Selecione uma face primeiro");
      return;
    }
    if (active.type === "boolean" || active.type === "path") {
      toast.info("Furar está disponível para peças primitivas");
      return;
    }
    try {
      const length = Math.max(...active.dimensions) + 30;
      const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...faceSelection.normal)));
      const cutter: ModelObject = {
        id: uid(), name: "Broca", type: "cylinder", position: faceSelection.point, rotation: [round(THREE.MathUtils.radToDeg(rotation.x)), round(THREE.MathUtils.radToDeg(rotation.y)), round(THREE.MathUtils.radToDeg(rotation.z))], scale: [1, 1, 1], dimensions: [Math.max(1, holeDiameter), length, Math.max(1, holeDiameter)], color: "#ffffff", visible: true,
      };
      const result = new Evaluator().evaluate(geometryForBrush(active), geometryForBrush(cutter), SUBTRACTION);
      const serialized = serializeWorldGeometry(result.geometry, result.matrixWorld);
      const drilled: ModelObject = { id: uid(), name: `Furo · ${active.name}`, type: "boolean", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: serialized.dimensions, color: active.color, visible: true, geometryData: serialized.data };
      commit([...objectsRef.current.filter((item) => item.id !== active.id), drilled]);
      setSelectedIds([drilled.id]);
      setFaceSelection(null);
      toast.success(`Furo de ${round(holeDiameter)} mm criado`);
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível furar essa face");
    }
  }, [active, commit, faceSelection, holeDiameter]);

  const applyContourOperation = useCallback((kind: "hole" | "cut") => {
    if (!active || !faceSelection || !faceContour || faceSelection.id !== active.id) {
      toast.info("Selecione uma face e arraste para criar um contorno");
      return;
    }
    const frame = contourFrame(faceContour, faceSelection);
    try {
      const orientation = new THREE.Matrix4().makeBasis(frame.tangent, frame.normal, frame.bitangent);
      const rotation = new THREE.Euler().setFromRotationMatrix(orientation);
      const cutter: ModelObject = {
        id: uid(),
        name: "Cortador de contorno",
        type: "box",
        position: [round(frame.center.x), round(frame.center.y), round(frame.center.z)],
        rotation: [round(THREE.MathUtils.radToDeg(rotation.x)), round(THREE.MathUtils.radToDeg(rotation.y)), round(THREE.MathUtils.radToDeg(rotation.z))],
        scale: [1, 1, 1],
        dimensions: [frame.width, Math.max(...active.dimensions) + 30, frame.height],
        color: "#ffffff",
        visible: true,
      };
      const result = new Evaluator().evaluate(geometryForBrush(active), geometryForBrush(cutter), SUBTRACTION);
      const serialized = serializeWorldGeometry(result.geometry, result.matrixWorld);
      const carved: ModelObject = { id: uid(), name: kind === "hole" ? `Furo contornado · ${active.name}` : `Recorte contornado · ${active.name}`, type: "boolean", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: serialized.dimensions, color: active.color, visible: true, geometryData: serialized.data };
      commit([...objectsRef.current.filter((item) => item.id !== active.id), carved]);
      setSelectedIds([carved.id]);
      setFaceContour(null);
      setFaceSelection(null);
      toast.success(kind === "hole" ? "Furação criada pelo contorno" : "Recorte criado pelo contorno");
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível aplicar o contorno nessa peça");
    }
  }, [active, commit, faceContour, faceSelection]);

  const applyFillet = useCallback(() => {
    if (!active) {
      toast.info("Selecione um cubo para aplicar concordância");
      return;
    }
    if (active.type !== "box") {
      toast.info("A concordância nesta versão funciona em cubos");
      return;
    }
    const maxRadius = Math.max(0, Math.min(...active.dimensions) / 2 - 0.1);
    const percent = Math.min(100, Math.max(0, filletPercent));
    const radius = round(maxRadius * (percent / 100));
    updateModel(active.id, { filletRadius: radius });
    toast.success(`Bordas arredondadas em ${round(percent)}% · raio de ${radius} mm`);
  }, [active, filletPercent, updateModel]);

  const applyHollow = useCallback(() => {
    if (!active) {
      toast.info("Selecione uma peça para usar Vazar");
      return;
    }
    if (active.type === "boolean") {
      toast.info("Vazar funciona em peças primitivas nesta versão");
      return;
    }
    const maxThickness = Math.min(...active.dimensions) / 2 - 0.2;
    if (maxThickness <= 0) {
      toast.error("A peça é pequena demais para criar uma parede interna");
      return;
    }
    const thickness = Math.min(Math.max(0.2, wallThickness), maxThickness);
    const inner: ModelObject = {
      ...active,
      id: uid(),
      name: `${active.name} · núcleo removido`,
      dimensions: active.dimensions.map((value) => Math.max(0.4, value - thickness * 2)) as Vec3,
      filletRadius: active.filletRadius ? Math.max(0, active.filletRadius - thickness) : 0,
    };
    try {
      const evaluator = new Evaluator();
      const result = evaluator.evaluate(geometryForBrush(active), geometryForBrush(inner), SUBTRACTION);
      const serialized = serializeWorldGeometry(result.geometry, result.matrixWorld);
      const shell: ModelObject = {
        id: uid(),
        name: `Vazado · ${active.name}`,
        type: "boolean",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        dimensions: serialized.dimensions,
        color: active.color,
        visible: true,
        geometryData: serialized.data,
      };
      commit([...objectsRef.current.filter((item) => item.id !== active.id), shell]);
      setSelectedIds([shell.id]);
      toast.success(`Peça vazada com parede de ${round(thickness)} mm`);
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível criar a parede interna desta peça");
    }
  }, [active, commit, wallThickness]);

  const addPrimitive = useCallback((type: Exclude<ShapeType, "boolean">) => {
    const next = createModel(type, objectsRef.current.length);
    commit([...objectsRef.current, next]);
    setSelectedIds([next.id]);
    toast.success(`${typeLabels[type]} adicionado`);
  }, [commit]);

  const followPath = useCallback(() => {
    if (pathPoints.length < 2) {
      toast.info("Desenhe pelo menos dois pontos para usar Seguir caminho");
      return;
    }
    const path: ModelObject = {
      id: uid(),
      name: "Caminho seguido",
      type: "path",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      dimensions: [Math.max(1, pathRadius * 2), Math.max(1, pathRadius * 2), Math.max(1, pathRadius * 2)],
      color: COLORS[objectsRef.current.length % COLORS.length],
      pathPoints: pathPoints.map((point) => [...point] as Vec3),
      visible: true,
    };
    commit([...objectsRef.current, path]);
    setSelectedIds([path.id]);
    setPathMode(false);
    setPathPoints([]);
    toast.success("Perfil seguido pelo caminho");
  }, [commit, pathPoints, pathRadius]);

  const anchorPosition = useCallback((host: ModelObject, role: ComponentRole): Vec3 => {
    const bounds = worldBounds(host);
    const center = bounds.getCenter(new THREE.Vector3());
    return [round(center.x), round(bounds.max.y + componentHeight(role) / 2), round(center.z)];
  }, []);

  const addComponentForHost = useCallback((role: ComponentRole, hostId: string | undefined, position?: Vec3, rotation: Vec3 = [0, 0, 0], shouldAnchor = autoAnchor) => {
    if (!hostId) {
      toast.info("Selecione uma peça-base antes de adicionar a fixação");
      return;
    }
    const host = objectsRef.current.find((item) => item.id === hostId);
    if (!host) return;
    const component = createComponent(role, host, position ?? anchorPosition(host, role), rotation);
    if (!shouldAnchor) delete component.anchorTo;
    commit([...objectsRef.current, component]);
    setSelectedIds([component.id]);
    toast.success(`${componentLabels[role]} criado individualmente`);
  }, [anchorPosition, autoAnchor, commit]);

  const addLockPair = useCallback(() => {
    const hosts = selectedIds.slice(0, 2).map((id) => objectsRef.current.find((item) => item.id === id)).filter(Boolean) as ModelObject[];
    if (!hosts.length) {
      toast.info("Selecione uma ou duas peças para criar o par macho/fêmea");
      return;
    }
    if (hosts.some((item) => item.type === "boolean")) {
      toast.info("Escolha peças primitivas para criar pinos de encaixe");
      return;
    }
    const maleHost = hosts[0];
    const malePosition = anchorPosition(maleHost, "lockPin");
    const femaleHost = hosts[1] ?? maleHost;
    const femalePosition = anchorPosition(femaleHost, "counterLock");
    if (!hosts[1]) femalePosition[0] = round(femalePosition[0] + maleHost.dimensions[0] / 2 + 12);
    const male = createComponent("lockPin", maleHost, malePosition);
    const female = createComponent("counterLock", femaleHost, femalePosition);
    commit([...objectsRef.current, male, female]);
    setSelectedIds([male.id, female.id]);
    toast.success("Par macho/fêmea criado com folga de encaixe");
  }, [anchorPosition, commit, selectedIds]);

  const deleteSelection = useCallback(() => {
    if (!selectedIds.length) return;
    commit(objectsRef.current.filter((item) => !selectedIds.includes(item.id)));
    setSelectedIds([]);
    toast.success("Seleção excluída");
  }, [commit, selectedIds]);

  const duplicateSelection = useCallback(() => {
    if (!selectedIds.length) return;
    const copies = objectsRef.current
      .filter((item) => selectedIds.includes(item.id))
      .map((item, index) => ({
        ...cloneObjects([item])[0],
        id: uid(),
        name: `${item.name} cópia`,
        position: [item.position[0] + 20 + index * 8, item.position[1], item.position[2] + 20] as Vec3,
      }));
    commit([...objectsRef.current, ...copies]);
    setSelectedIds(copies.map((item) => item.id));
    toast.success("Cópia criada");
  }, [commit, selectedIds]);

  const groupSelection = useCallback(() => {
    if (selectedIds.length < 2) return toast.info("Selecione dois ou mais objetos para agrupar");
    const groupId = uid();
    commit(objectsRef.current.map((item) => selectedIds.includes(item.id) ? { ...item, groupId } : item));
    toast.success("Objetos agrupados");
  }, [commit, selectedIds]);

  const ungroupSelection = useCallback(() => {
    if (!selectedIds.length) return;
    commit(objectsRef.current.map((item) => selectedIds.includes(item.id) ? { ...item, groupId: undefined } : item));
    toast.success("Grupo desfeito");
  }, [commit, selectedIds]);

  const mirrorSelection = useCallback((axis: 0 | 1 | 2) => {
    if (!selectedIds.length) return;
    commit(objectsRef.current.map((item) => {
      if (!selectedIds.includes(item.id)) return item;
      const scale = [...item.scale] as Vec3;
      scale[axis] *= -1;
      return { ...item, scale };
    }));
    toast.success(`Espelho aplicado no eixo ${["X", "Y", "Z"][axis]}`);
  }, [commit, selectedIds]);

  const applyBoolean = useCallback((mode: BooleanMode) => {
    if (selectedIds.length !== 2) {
      toast.info("Selecione exatamente dois sólidos para uma operação booleana");
      return;
    }
    const [first, second] = selectedIds.map((id) => objectsRef.current.find((item) => item.id === id)).filter(Boolean) as ModelObject[];
    try {
      const evaluator = new Evaluator();
      const firstBrush = geometryForBrush(first);
      const secondBrush = geometryForBrush(second);
      const operation = mode === "union" ? ADDITION : mode === "subtract" ? SUBTRACTION : INTERSECTION;
      const result = evaluator.evaluate(firstBrush, secondBrush, operation);
      const serialized = serializeWorldGeometry(result.geometry, result.matrixWorld);
      const combined: ModelObject = {
        id: uid(),
        name: mode === "union" ? "União" : mode === "subtract" ? "Subtração" : "Interseção",
        type: "boolean",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        dimensions: serialized.dimensions,
        color: "#67e8c5",
        visible: true,
        geometryData: serialized.data,
      };
      commit([...objectsRef.current.filter((item) => !selectedIds.includes(item.id)), combined]);
      setSelectedIds([combined.id]);
      toast.success(`${combined.name} criada`);
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível calcular essa operação com os sólidos atuais");
    }
  }, [commit, selectedIds]);

  const cutSelection = useCallback(() => {
    if (selectedIds.length !== 2) {
      toast.info("Selecione a peça e depois o sólido de corte");
      return;
    }
    applyBoolean("subtract");
  }, [applyBoolean, selectedIds.length]);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return toast.info("Nada para desfazer");
    redoRef.current.push(snapshot());
    setObjects(previous);
    setSelectedIds([]);
    setSaved(false);
  }, [snapshot]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return toast.info("Nada para refazer");
    historyRef.current.push(snapshot());
    setObjects(next);
    setSelectedIds([]);
    setSaved(false);
  }, [snapshot]);

  const exportStl = useCallback(() => {
    if (validation.tone !== "success") {
      toast.error("Corrija os alertas antes de exportar o STL");
      return;
    }
    const exportGroup = new THREE.Group();
    objectsRef.current.forEach((model) => {
      if (!model.visible) return;
      const geometry = makeGeometry(model).toNonIndexed();
      geometry.applyMatrix4(modelMatrix(model));
      geometry.deleteAttribute("uv");
      geometry.computeVertexNormals();
      exportGroup.add(new THREE.Mesh(geometry));
    });
    const sourceGeometries = exportGroup.children.map((child) => (child as THREE.Mesh).geometry);
    if (sourceGeometries.length === 0) {
      toast.error("Ative pelo menos um objeto antes de exportar");
      return;
    }
    const merged = mergeGeometries(sourceGeometries, false);
    if (!merged) {
      toast.error("Não foi possível unir as geometrias para exportação");
      return;
    }
    merged.computeVertexNormals();
    const stl = new STLExporter().parse(new THREE.Mesh(merged), { binary: false });
    const blob = new Blob([stl], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "modela3d-peca.stl";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("STL exportado com sucesso");
  }, [validation.tone]);

  const saveProject = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(objectsRef.current));
    setSaved(true);
    toast.success("Projeto salvo neste navegador");
  }, []);

  const newProject = useCallback(() => {
    if (objectsRef.current.length && !window.confirm("Começar um novo projeto? O estado atual continuará salvo apenas se você já tiver clicado em Salvar.")) return;
    const first = createModel("box", 0);
    commit([first]);
    setSelectedIds([first.id]);
    setSaved(false);
  }, [commit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c131d");
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 3000);
    camera.position.set(420, 320, 460);
    cameraRef.current = camera;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    rendererRef.current = renderer;

    const orbit = new OrbitControls(camera, canvas);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, 45, 0);
    orbit.minDistance = 80;
    orbit.maxDistance = 1200;
    orbitRef.current = orbit;

    const transform = new TransformControls(camera, canvas);
    transform.setSize(0.8);
    transform.addEventListener("dragging-changed", (event) => {
      orbit.enabled = !(event as { value: boolean }).value;
      if (!(event as { value: boolean }).value && transformHistoryStartedRef.current) {
        transformHistoryStartedRef.current = false;
        setObjects(cloneObjects(objectsRef.current));
        setSaved(false);
      }
    });
    transform.addEventListener("mouseDown", () => {
      if (!transformHistoryStartedRef.current) {
        historyRef.current.push(snapshot());
        redoRef.current = [];
        transformHistoryStartedRef.current = true;
      }
    });
    transform.addEventListener("objectChange", () => {
      const activeGroup = transform.object as THREE.Group | undefined;
      const id = activeGroup?.userData.modelId as string | undefined;
      if (!id || !activeGroup) return;
      const previous = objectsRef.current.find((item) => item.id === id);
      const nextPosition: Vec3 = [round(activeGroup.position.x), round(activeGroup.position.y), round(activeGroup.position.z)];
      const delta = previous ? nextPosition.map((value, index) => value - previous.position[index]) as Vec3 : [0, 0, 0];
      objectsRef.current = objectsRef.current.map((item) => item.id === id ? {
        ...item,
        position: nextPosition,
        rotation: [round(THREE.MathUtils.radToDeg(activeGroup.rotation.x)), round(THREE.MathUtils.radToDeg(activeGroup.rotation.y)), round(THREE.MathUtils.radToDeg(activeGroup.rotation.z))],
        scale: [round(activeGroup.scale.x), round(activeGroup.scale.y), round(activeGroup.scale.z)],
      } : item.anchorTo === id ? {
        ...item,
        position: item.position.map((value, index) => round(value + delta[index])) as Vec3,
      } : item);
      setTransformTick((value) => value + 1);
      if (selectionHelperRef.current) selectionHelperRef.current.update();
    });
    scene.add(transform.getHelper());
    transformRef.current = transform;

    scene.add(new THREE.HemisphereLight("#d9f4ff", "#162337", 2.1));
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.3);
    keyLight.position.set(220, 360, 260);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight("#6c9dff", 0.8);
    fillLight.position.set(-260, 140, -220);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(600, 60, "#476174", "#1d2b3b");
    grid.name = "grid";
    scene.add(grid);
    const axes = new THREE.AxesHelper(170);
    axes.name = "axes";
    scene.add(axes);
    const workbox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(LIMIT, LIMIT, LIMIT)),
      new THREE.LineBasicMaterial({ color: "#315267", transparent: true, opacity: 0.7 }),
    );
    workbox.position.y = 0;
    workbox.name = "workbox";
    scene.add(workbox);

    let resizeFrame = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    const resize = (observedWidth?: number, observedHeight?: number) => {
      const bounds = canvas.parentElement?.getBoundingClientRect();
      const width = Math.floor(observedWidth ?? bounds?.width ?? 0);
      const height = Math.floor(observedHeight ?? bounds?.height ?? 0);
      if (!width || !height || (width === lastWidth && height === lastHeight)) return;
      lastWidth = width;
      lastHeight = height;
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
    };
    resize();
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      resize(rect?.width, rect?.height);
    });
    observer.observe(canvas.parentElement ?? canvas);

    let animationFrame = 0;
    const frame = () => {
      orbit.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      scene.clear();
    };
  }, [snapshot]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === "w") setTool("translate");
      if (event.key.toLowerCase() === "e") setTool("rotate");
      if (event.key.toLowerCase() === "r") setTool("scale");
      if (event.key === "Delete" || event.key === "Backspace") deleteSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelection]);

  useEffect(() => {
    const scene = sceneRef.current;
    const transform = transformRef.current;
    if (!scene || !transform) return;
    const grid = scene.getObjectByName("grid");
    const axes = scene.getObjectByName("axes");
    if (grid) grid.visible = showGrid;
    if (axes) axes.visible = showAxes;
  }, [showAxes, showGrid]);

  useEffect(() => {
    const scene = sceneRef.current;
    const transform = transformRef.current;
    if (!scene || !transform) return;
    meshMapRef.current.forEach((group) => scene.remove(group));
    meshMapRef.current.clear();
    objects.forEach((model) => {
      const group = new THREE.Group();
      group.userData.modelId = model.id;
      group.position.set(...model.position);
      group.rotation.set(
        THREE.MathUtils.degToRad(model.rotation[0]),
        THREE.MathUtils.degToRad(model.rotation[1]),
        THREE.MathUtils.degToRad(model.rotation[2]),
      );
      group.scale.set(...model.scale);
      group.visible = model.visible;
      const material = new THREE.MeshStandardMaterial({
        color: model.color,
        roughness: 0.26,
        metalness: 0.08,
        transparent: true,
        opacity: inspectInterior && model.id === activeId ? 0.24 : selectedIds.includes(model.id) ? 0.95 : 0.88,
        depthWrite: !(inspectInterior && model.id === activeId),
        side: inspectInterior && model.id === activeId ? THREE.DoubleSide : THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(makeGeometry(model), material);
      mesh.renderOrder = inspectInterior && model.id === activeId ? 2 : 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.modelId = model.id;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 28),
        new THREE.LineBasicMaterial({ color: inspectInterior && model.id === activeId ? "#b6a5ff" : selectedIds.includes(model.id) ? "#ffffff" : "#101c27", transparent: true, opacity: inspectInterior && model.id === activeId ? 0.95 : selectedIds.includes(model.id) ? 0.8 : 0.4 }),
      );
      edges.renderOrder = 3;
      group.add(mesh, edges);
      scene.add(group);
      meshMapRef.current.set(model.id, group);
    });
    const previousHatch = scene.getObjectByName("face-hatch");
    if (previousHatch) scene.remove(previousHatch);
    if (faceSelection && !faceContour) {
      const selectedModel = objects.find((item) => item.id === faceSelection.id);
      if (selectedModel) {
        const faceSize = faceSelection.axis === 0 ? [selectedModel.dimensions[2], selectedModel.dimensions[1]] : faceSelection.axis === 1 ? [selectedModel.dimensions[0], selectedModel.dimensions[2]] : [selectedModel.dimensions[0], selectedModel.dimensions[1]];
        const hatch = new THREE.Mesh(
          new THREE.PlaneGeometry(faceSize[0], faceSize[1], 12, 12),
          new THREE.MeshBasicMaterial({ color: "#f2c76e", transparent: true, opacity: 0.78, wireframe: true, side: THREE.DoubleSide, depthTest: false }),
        );
        hatch.name = "face-hatch";
        hatch.position.set(...faceSelection.point);
        hatch.position.add(new THREE.Vector3(...faceSelection.normal).multiplyScalar(0.05));
        const worldNormal = new THREE.Vector3(...faceSelection.normal).normalize();
        const worldTangent = new THREE.Vector3(...faceSelection.tangent).normalize();
        const worldBitangent = worldNormal.clone().cross(worldTangent).normalize();
        hatch.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(worldTangent, worldBitangent, worldNormal));
        hatch.renderOrder = 10;
        scene.add(hatch);
      }
    }
    const previousContour = scene.getObjectByName("face-contour");
    if (previousContour) scene.remove(previousContour);
    if (faceSelection && faceContour) {
      const frame = contourFrame(faceContour, faceSelection);
      const halfWidth = frame.width / 2;
      const halfHeight = frame.height / 2;
      const offset = frame.normal.clone().multiplyScalar(0.15);
      const center = frame.center.clone().add(offset);
      const points = [
        center.clone().add(frame.tangent.clone().multiplyScalar(-halfWidth)).add(frame.bitangent.clone().multiplyScalar(-halfHeight)),
        center.clone().add(frame.tangent.clone().multiplyScalar(halfWidth)).add(frame.bitangent.clone().multiplyScalar(-halfHeight)),
        center.clone().add(frame.tangent.clone().multiplyScalar(halfWidth)).add(frame.bitangent.clone().multiplyScalar(halfHeight)),
        center.clone().add(frame.tangent.clone().multiplyScalar(-halfWidth)).add(frame.bitangent.clone().multiplyScalar(halfHeight)),
      ];
      const contourLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: "#ff6b9d", linewidth: 2, depthTest: false }));
      contourLine.name = "face-contour";
      contourLine.renderOrder = 12;
      scene.add(contourLine);
    }
    if (selectionHelperRef.current) scene.remove(selectionHelperRef.current);
    if (activeId && meshMapRef.current.has(activeId)) {
      const helper = new THREE.BoxHelper(meshMapRef.current.get(activeId)!, "#f2c76e");
      helper.material.transparent = true;
      helper.material.opacity = 0.95;
      scene.add(helper);
      selectionHelperRef.current = helper;
      transform.attach(meshMapRef.current.get(activeId)!);
      transform.setMode(tool);
      transform.setSpace(faceSelection?.id === activeId ? "local" : "world");
    } else {
      transform.detach();
      selectionHelperRef.current = null;
    }
  }, [activeId, faceContour, faceSelection, inspectInterior, objects, selectedIds, tool]);

  const handleCanvasPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera) return;
    const rect = canvas.getBoundingClientRect();
    pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(pointerRef.current, camera);
    if (pathMode) {
      const point = raycasterRef.current.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      if (point) setPathPoints((current) => [...current, [round(point.x), round(pathRadius), round(point.z)]]);
      return;
    }
    const hits = raycasterRef.current.intersectObjects([...meshMapRef.current.values()], true);
    const hit = hits.find((entry) => entry.object instanceof THREE.Mesh && entry.object.userData.modelId && entry.face);
    if (faceSelection && faceMode && hit?.object.userData.modelId === faceSelection.id) {
      if (event.ctrlKey) {
        historyRef.current.push(cloneObjects(objectsRef.current));
        redoRef.current = [];
        faceDragRef.current = { id: faceSelection.id, axis: faceSelection.axis, sign: faceSelection.sign, startY: event.clientY, baseObjects: cloneObjects(objectsRef.current) };
        setFaceContour(null);
        setDraggingFace(true);
        orbitRef.current?.enabled && (orbitRef.current.enabled = false);
        return;
      }
      const plane = new THREE.Plane(new THREE.Vector3(...faceSelection.normal), -new THREE.Vector3(...faceSelection.normal).dot(new THREE.Vector3(...faceSelection.point)));
      const point = raycasterRef.current.ray.intersectPlane(plane, new THREE.Vector3());
      if (point) {
        contourStartRef.current = point.clone();
        setFaceContour({ start: [round(point.x), round(point.y), round(point.z)], end: [round(point.x), round(point.y), round(point.z)] });
        setDrawingContour(true);
        orbitRef.current?.enabled && (orbitRef.current.enabled = false);
      }
      return;
    }
    if (faceMode && hit?.face && hit.object instanceof THREE.Mesh) {
      const localNormal = hit.face.normal.clone().normalize();
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      const worldNormal = localNormal.clone().applyMatrix3(normalMatrix).normalize();
      const axis = (Math.abs(localNormal.x) > Math.abs(localNormal.y) && Math.abs(localNormal.x) > Math.abs(localNormal.z) ? 0 : Math.abs(localNormal.y) > Math.abs(localNormal.z) ? 1 : 2) as 0 | 1 | 2;
      const sign = (localNormal.getComponent(axis) >= 0 ? 1 : -1) as 1 | -1;
      const localTangent = axis === 0 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const worldTangent = localTangent.clone().transformDirection(hit.object.matrixWorld).normalize();
      const selectedModel = objectsRef.current.find((item) => item.id === hit.object.userData.modelId);
      const faceCenter = selectedModel && selectedModel.type !== "boolean"
        ? new THREE.Vector3(
            axis === 0 ? sign * selectedModel.dimensions[0] / 2 : 0,
            axis === 1 ? sign * selectedModel.dimensions[1] / 2 : 0,
            axis === 2 ? sign * selectedModel.dimensions[2] / 2 : 0,
          ).applyMatrix4(hit.object.matrixWorld)
        : hit.point.clone();
      setFaceSelection({ id: hit.object.userData.modelId as string, axis, sign, point: [round(faceCenter.x), round(faceCenter.y), round(faceCenter.z)], normal: [round(worldNormal.x), round(worldNormal.y), round(worldNormal.z)], tangent: [round(worldTangent.x), round(worldTangent.y), round(worldTangent.z)] });
      setSelectedIds([hit.object.userData.modelId as string]);
      toast.success(`Face selecionada · eixo ${["X", "Y", "Z"][axis]}`);
      return;
    }
    if (autoClick && hit) {
      const hostId = hit.object.userData.modelId as string;
      const normal = (hit.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0))
        .transformDirection(hit.object.matrixWorld)
        .normalize();
      const point = hit.point.clone().add(normal.clone().multiplyScalar(componentHeight(placementRole) / 2));
      const rotation = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal),
      );
      addComponentForHost(
        placementRole,
        hostId,
        [round(point.x), round(point.y), round(point.z)],
        [round(THREE.MathUtils.radToDeg(rotation.x)), round(THREE.MathUtils.radToDeg(rotation.y)), round(THREE.MathUtils.radToDeg(rotation.z))],
        autoAnchor,
      );
      return;
    }
    if (!hit) {
      if (autoClick) toast.info("Clique diretamente em uma face da peça para ancorar o componente");
      if (!event.shiftKey) setSelectedIds([]);
      return;
    }
    const id = hit.object.userData.modelId as string;
    setSelectedIds((current) => event.shiftKey ? current.includes(id) ? current.filter((item) => item !== id) : [...current, id] : [id]);
  };

  const handleCanvasPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingFace && faceDragRef.current) {
      const drag = faceDragRef.current;
      const amount = round((drag.startY - event.clientY) * 0.35);
      const base = drag.baseObjects.find((item) => item.id === drag.id);
      if (base) {
        const nextDimensions = [...base.dimensions] as Vec3;
        nextDimensions[drag.axis] = Math.max(1, round(nextDimensions[drag.axis] + amount));
        const dimensionDelta = nextDimensions[drag.axis] - base.dimensions[drag.axis];
        const nextPosition = [...base.position] as Vec3;
        nextPosition[drag.axis] = round(nextPosition[drag.axis] + drag.sign * dimensionDelta / 2);
        const next = drag.baseObjects.map((item) => item.id === drag.id
          ? { ...item, dimensions: nextDimensions, position: nextPosition }
          : item.anchorTo === drag.id
            ? { ...item, position: item.position.map((value, index) => round(value + (index === drag.axis ? drag.sign * dimensionDelta / 2 : 0))) as Vec3 }
            : item);
        objectsRef.current = next;
        setObjects(next);
        setSaved(false);
      }
      return;
    }
    if (!drawingContour || !faceSelection) return;
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera || !contourStartRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycasterRef.current.setFromCamera(pointer, camera);
    const normal = new THREE.Vector3(...faceSelection.normal);
    const plane = new THREE.Plane(normal, -normal.dot(new THREE.Vector3(...faceSelection.point)));
    const point = raycasterRef.current.ray.intersectPlane(plane, new THREE.Vector3());
    if (point) setFaceContour({ start: [round(contourStartRef.current.x), round(contourStartRef.current.y), round(contourStartRef.current.z)], end: [round(point.x), round(point.y), round(point.z)] });
  };

  const handleCanvasPointerUp = () => {
    if (draggingFace) {
      setDraggingFace(false);
      faceDragRef.current = null;
      if (orbitRef.current) orbitRef.current.enabled = true;
      toast.success("Face ajustada por Ctrl-drag");
      return;
    }
    if (!drawingContour) return;
    setDrawingContour(false);
    contourStartRef.current = null;
    if (!faceContour || (Math.abs(faceContour.start[0] - faceContour.end[0]) < 2 && Math.abs(faceContour.start[2] - faceContour.end[2]) < 2)) {
      setFaceContour(null);
      toast.info("Arraste uma área menor sobre a face para criar o contorno");
    } else {
      toast.success("Contorno criado: escolha Furar contorno ou Recortar contorno");
    }
    if (orbitRef.current) orbitRef.current.enabled = true;
  };

  const handleCanvasDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera) return;
    const rect = canvas.getBoundingClientRect();
    raycasterRef.current.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = raycasterRef.current.intersectObjects([...meshMapRef.current.values()], true).find((entry) => entry.object instanceof THREE.Mesh && entry.object.userData.modelId && entry.face);
    if (!hit || !(hit.object instanceof THREE.Mesh) || !hit.face) return;
    const localNormal = hit.face.normal.clone().normalize();
    const worldNormal = localNormal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    const axis = (Math.abs(localNormal.x) > Math.abs(localNormal.y) && Math.abs(localNormal.x) > Math.abs(localNormal.z) ? 0 : Math.abs(localNormal.y) > Math.abs(localNormal.z) ? 1 : 2) as 0 | 1 | 2;
    const sign = (localNormal.getComponent(axis) >= 0 ? 1 : -1) as 1 | -1;
    const tangent = (axis === 0 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).transformDirection(hit.object.matrixWorld).normalize();
    const selectedModel = objectsRef.current.find((item) => item.id === hit.object.userData.modelId);
    const center = selectedModel && selectedModel.type !== "boolean" ? new THREE.Vector3(axis === 0 ? sign * selectedModel.dimensions[0] / 2 : 0, axis === 1 ? sign * selectedModel.dimensions[1] / 2 : 0, axis === 2 ? sign * selectedModel.dimensions[2] / 2 : 0).applyMatrix4(hit.object.matrixWorld) : hit.point.clone();
    setFaceSelection({ id: hit.object.userData.modelId as string, axis, sign, point: [round(center.x), round(center.y), round(center.z)], normal: [round(worldNormal.x), round(worldNormal.y), round(worldNormal.z)], tangent: [round(tangent.x), round(tangent.y), round(tangent.z)] });
    setSelectedIds([hit.object.userData.modelId as string]);
    setFaceMode(true);
    toast.success("Face selecionada. Arraste sobre ela para criar um contorno.");
  };

  const frameSelection = () => {
    const target = activeId ? meshMapRef.current.get(activeId) : undefined;
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!target || !camera || !orbit) return;
    const box = new THREE.Box3().setFromObject(target);
    const center = box.getCenter(new THREE.Vector3());
    orbit.target.copy(center);
    camera.position.copy(center.clone().add(new THREE.Vector3(220, 160, 260)));
    orbit.update();
  };

  const setCameraView = (nextView: "perspective" | "top") => {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) return;
    setView(nextView);
    if (nextView === "top") camera.position.set(0, 600, 0.01);
    else camera.position.set(420, 320, 460);
    orbit.target.set(0, 40, 0);
    orbit.update();
  };

  const resetView = () => setCameraView("perspective");

  const selectedCountLabel = selectedIds.length === 1 ? "1 objeto selecionado" : `${selectedIds.length} objetos selecionados`;

  return (
    <div className="modeler-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Shapes size={19} strokeWidth={2.4} /></div>
          <div>
            <div className="brand-name">MODELA<span>3D</span></div>
            <div className="brand-subtitle">atelier de peças</div>
          </div>
        </div>
        <div className="project-name"><Pencil size={14} /> Projeto sem título <span className="save-dot" data-saved={saved} /></div>
        <div className="top-actions">
          <button className="ghost-button" onClick={newProject}><Plus size={15} /> Novo</button>
          <button className="ghost-button" onClick={saveProject}><Save size={15} /> Salvar</button>
          <button className="primary-button" onClick={exportStl}><Download size={16} /> Exportar STL</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-rail">
          <div className="rail-heading"><span>Adicionar</span><Sparkles size={14} /></div>
          <div className="primitive-grid">
            <button onClick={() => addPrimitive("box")}><span className="primitive-icon"><Cuboid size={19} /></span><small>Cubo</small></button>
            <button onClick={() => addPrimitive("cylinder")}><span className="primitive-icon"><Circle size={19} /></span><small>Cilindro</small></button>
            <button onClick={() => addPrimitive("sphere")}><span className="primitive-icon sphere-icon">●</span><small>Esfera</small></button>
            <button onClick={() => addPrimitive("cone")}><span className="primitive-icon"><Cone size={19} /></span><small>Cone</small></button>
            <button onClick={() => addPrimitive("prism")}><span className="primitive-icon"><Box size={19} /></span><small>Prisma</small></button>
            <button onClick={() => addPrimitive("screw")}><span className="primitive-icon"><Plus size={19} /></span><small>Parafuso</small></button>
            <button onClick={() => addPrimitive("nut")}><span className="primitive-icon"><Circle size={19} /></span><small>Porca</small></button>
          </div>

          <div className="rail-divider" />
          <div className="rail-heading"><span>Ferramentas</span><Settings2 size={14} /></div>
          <div className="tool-stack">
            <button className={tool === "translate" ? "selected" : ""} onClick={() => setTool("translate")}><Move3d size={17} /><span>Mover peça</span><kbd>W</kbd></button>
            <button className={tool === "rotate" ? "selected" : ""} onClick={() => setTool("rotate")}><Rotate3d size={17} /><span>Rotacionar</span><kbd>E</kbd></button>
            <button className={tool === "scale" ? "selected" : ""} onClick={() => setTool("scale")}><Maximize2 size={17} /><span>Escalar</span><kbd>R</kbd></button>
            <button className={faceMode ? "selected" : ""} onClick={() => { setFaceMode((value) => !value); setPathMode(false); }}><Square size={17} /><span>Selecionar face</span></button>
            <button className={pathMode ? "selected" : ""} onClick={() => { setPathMode((value) => !value); setFaceMode(false); if (!pathMode) setPathPoints([]); }}><Pencil size={17} /><span>Desenhar linha</span></button>
          </div>

          <div className="rail-divider" />
          <div className="rail-heading"><span>Operações</span><Scissors size={14} /></div>
          <div className="operation-grid">
            <button onClick={() => applyBoolean("union")} disabled={selectedIds.length !== 2}><span className="op-symbol">∪</span><small>União</small></button>
            <button onClick={() => applyBoolean("subtract")} disabled={selectedIds.length !== 2}><span className="op-symbol">−</span><small>Subtrair</small></button>
            <button onClick={() => applyBoolean("intersect")} disabled={selectedIds.length !== 2}><span className="op-symbol">∩</span><small>Interseção</small></button>
          </div>
          <div className="tool-stack compact modeling-tools">
            <button onClick={cutSelection} disabled={selectedIds.length !== 2}><Scissors size={16} /><span>Recortar</span></button>
            <button onClick={() => applyPushPull()} disabled={!active}><Move3d size={16} /><span>Puxar / empurrar</span></button>
            <button onClick={applyFillet} disabled={!active}><Circle size={16} /><span>Arredondar bordas</span></button>
            <button onClick={applyHollow} disabled={!active}><Shapes size={16} /><span>Vazar</span></button>
            <button onClick={followPath} disabled={pathPoints.length < 2}><Pencil size={16} /><span>Seguir caminho ({pathPoints.length})</span></button>
          </div>
          <div className="tool-stack compact">
            <button onClick={duplicateSelection} disabled={!selectedIds.length}><Copy size={16} /><span>Duplicar</span></button>
            <button onClick={groupSelection} disabled={selectedIds.length < 2}><Layers size={16} /><span>Agrupar</span></button>
            <button onClick={ungroupSelection} disabled={!selectedIds.length}><Ungroup size={16} /><span>Desagrupar</span></button>
            <button onClick={deleteSelection} disabled={!selectedIds.length} className="danger-action"><Trash2 size={16} /><span>Excluir</span></button>
          </div>

          <div className="rail-divider" />
          <div className="rail-heading"><span>Fixação inteligente</span><Sparkles size={14} /></div>
          <div className="fixation-card">
            <div className="fixation-label">Componente individual</div>
            <div className="role-selector">
              {(Object.keys(componentLabels) as ComponentRole[]).map((role) => <button key={role} className={placementRole === role ? "active" : ""} onClick={() => setPlacementRole(role)}>{componentLabels[role]}</button>)}
            </div>
            <button className={`toggle-row ${autoAnchor ? "on" : ""}`} onClick={() => setAutoAnchor((value) => !value)}><span className="toggle-dot" /><span><strong>Autoancoragem</strong><small>Vincula à peça selecionada</small></span><b>{autoAnchor ? "ON" : "OFF"}</b></button>
            <button className={`toggle-row ${autoClick ? "on" : ""}`} onClick={() => setAutoClick((value) => !value)}><span className="toggle-dot" /><span><strong>Autoclique</strong><small>Clique em uma face para posicionar</small></span><b>{autoClick ? "ON" : "OFF"}</b></button>
            <button className="anchor-action" onClick={() => addComponentForHost(placementRole, activeId)} disabled={!activeId}><Plus size={14} /> Adicionar na peça selecionada</button>
            <button className="pair-action" onClick={addLockPair} disabled={!activeId}><Plus size={14} /> Criar par macho / fêmea</button>
            <small className="pair-hint">Selecione duas peças para colocar um lado em cada uma.</small>
          </div>

          <div className="rail-footer">
            <div className="legend-row"><span className="legend-dot green" /> Dentro do limite</div>
            <div className="legend-row"><span className="legend-dot amber" /> Revisar antes de exportar</div>
          </div>
        </aside>

        <section className="viewport-panel">
          <div className="viewport-toolbar">
            <div className="toolbar-cluster">
              <button className={view === "perspective" ? "view-button active" : "view-button"} onClick={() => setCameraView("perspective")}>Perspectiva</button>
              <button className={view === "top" ? "view-button active" : "view-button"} onClick={() => setCameraView("top")}>Superior</button>
            </div>
            <div className="toolbar-cluster">
              <IconButton label="Mostrar/ocultar grade" active={showGrid} onClick={() => setShowGrid((value) => !value)}>{showGrid ? <Grid3X3 size={16} /> : <EyeOff size={16} />}</IconButton>
              <IconButton label="Mostrar/ocultar eixos" active={showAxes} onClick={() => setShowAxes((value) => !value)}><span className="axis-mini">XYZ</span></IconButton>
              <IconButton label="Enquadrar seleção" onClick={frameSelection}><Maximize2 size={16} /></IconButton>
              <IconButton label="Redefinir vista" onClick={resetView}><Circle size={15} /></IconButton>
            </div>
          </div>
          <div className="viewport-stage">
            <canvas ref={canvasRef} onPointerDown={handleCanvasPointer} onPointerMove={handleCanvasPointerMove} onPointerUp={handleCanvasPointerUp} onDoubleClick={handleCanvasDoubleClick} />
            <div className="viewport-hint">{pathMode ? <><span>Desenho ativo:</span> clique no plano para adicionar pontos · {pathPoints.length} ponto(s)</> : faceMode ? <><span>Face ativa:</span> arraste para contorno · <span>Ctrl + arraste</span> para expandir/retrair</> : autoClick ? <><span>Autoclique ativo:</span> clique em uma face para criar {componentLabels[placementRole].toLowerCase()}</> : <><span>Arraste</span> para orbitar · <span>Shift + clique</span> para selecionar mais de um</>}</div>
            <div className="axis-labels"><span className="axis-x">X</span><span className="axis-y">Y</span><span className="axis-z">Z</span></div>
            <div className="work-size"><span>ÁREA ÚTIL</span><strong>300 × 300 × 300</strong><small>milímetros</small></div>
          </div>
          <div className="viewport-footer">
            <div className="status-line"><span className="live-dot" /> Cena ativa <span className="muted">•</span> {objects.length} {objects.length === 1 ? "objeto" : "objetos"} <span className="muted">•</span> {selectedCountLabel}</div>
            <div className="history-actions"><IconButton label="Desfazer" onClick={undo} disabled={!historyRef.current.length}><Undo2 size={16} /></IconButton><IconButton label="Refazer" onClick={redo} disabled={!redoRef.current.length}><Redo2 size={16} /></IconButton></div>
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-heading"><div><span className="eyebrow">Painel de controle</span><h1>Inspector</h1></div><button className="more-button"><ChevronDown size={16} /></button></div>
          <div className={`validation-card ${validation.tone}`}><div className="validation-icon">{validation.tone === "success" ? <Check size={15} /> : <span>!</span>}</div><div><strong>{validation.label}</strong><p>{validation.detail}</p></div></div>

          <section className="inspector-section">
            <div className="section-title"><span>Seleção</span><span className="count-pill">{selectedIds.length}</span></div>
            {active ? <>
              <div className="object-title"><span className="object-swatch" style={{ background: active.color }} /><div><strong>{active.name}</strong><small>{modelLabel(active)}{active.anchorTo ? " · Ancorado" : active.groupId ? " · Grupo" : ""}</small></div><button className="visibility-button" onClick={() => updateModel(active.id, { visible: !active.visible })}>{active.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button></div>
              <div className="inspector-actions"><button onClick={duplicateSelection}><Copy size={14} /> Duplicar</button><button onClick={() => mirrorSelection(0)}><span className="mirror-icon">↔</span> Espelhar X</button></div>
            </> : <div className="empty-inspector"><BoxSelect size={19} /><span>Selecione um objeto na cena<br />ou na lista abaixo.</span></div>}
          </section>

          <section className="inspector-section">
            <div className="section-title"><span>Dimensões</span><span className="unit-label">mm</span></div>
            <div className="fields-grid">
              <Field label="Largura" value={activeDimensions[0]} disabled={!active} onChange={(value) => active && updateVector(active.id, "dimensions", 0, Math.max(1, value))} />
              <Field label="Altura" value={activeDimensions[1]} disabled={!active} onChange={(value) => active && updateVector(active.id, "dimensions", 1, Math.max(1, value))} />
              <Field label="Profundidade" value={activeDimensions[2]} disabled={!active} onChange={(value) => active && updateVector(active.id, "dimensions", 2, Math.max(1, value))} />
            </div>
          </section>

          <section className="inspector-section modeling-section">
            <div className="section-title"><span>Modelagem direta</span><span className="unit-label">mm</span></div>
            <div className="sub-heading"><span>Puxar (+) / empurrar (−)</span><span>altura</span></div>
            <Field label="Valor" value={pushPullAmount} suffix="mm" disabled={!active} onChange={setPushPullAmount} />
            <div className="sub-heading"><span>Espessura da parede</span><span>vazar</span></div>
            <Field label="Parede" value={wallThickness} suffix="mm" disabled={!active} onChange={setWallThickness} />
            <div className="sub-heading"><span>Concordância</span><span>percentual</span></div>
            <Field label="Arredondamento" value={filletPercent} suffix="%" disabled={!active || active.type !== "box"} onChange={setFilletPercent} />
            <div className="sub-heading"><span>Perfil do caminho</span><span>raio</span></div>
            <Field label="Raio" value={pathRadius} suffix="mm" disabled={!pathMode} onChange={setPathRadius} />
            <div className="inspector-actions modeling-actions">
              <button onClick={() => applyPushPull()} disabled={!active}><Move3d size={14} /> Aplicar</button>
              <button onClick={applyFillet} disabled={!active || active.type !== "box"}><Circle size={14} /> Concordância</button>
            </div>
            <button className="hollow-action" onClick={applyHollow} disabled={!active}><Shapes size={14} /> Vazar peça</button>
            <button className={`inspect-action ${inspectInterior ? "active" : ""}`} onClick={() => setInspectInterior((value) => !value)} disabled={!active || active.name.startsWith("Vazado") === false}><Eye size={14} /> {inspectInterior ? "Ocultar interior" : "Ver interior da peça"}</button>
            {faceSelection && faceSelection.id === active?.id && <>
              <div className="sub-heading"><span>Face selecionada · eixo {["X", "Y", "Z"][faceSelection.axis]}</span><span>ações</span></div>
              <Field label="Diâmetro do furo" value={holeDiameter} suffix="mm" disabled={!active} onChange={setHoleDiameter} />
              <div className="face-actions">
                <button onClick={() => applyPushPull(Math.abs(pushPullAmount))}><Move3d size={13} /> Puxar</button>
                <button onClick={() => applyPushPull(-Math.abs(pushPullAmount))}><Minus size={13} /> Recuar</button>
                <button onClick={() => applyPushPull(Math.abs(pushPullAmount))}><Move3d size={13} /> Mover</button>
                <button onClick={drillFace}><Circle size={13} /> Furar</button>
                <button onClick={deleteFace} className="danger-face-action"><Trash2 size={13} /> Deletar</button>
              </div>
              {faceContour && <div className="face-actions contour-actions">
                <button onClick={() => applyContourOperation("hole")}><Circle size={13} /> Furar contorno</button>
                <button onClick={() => applyContourOperation("cut")}><Scissors size={13} /> Recortar contorno</button>
              </div>}
              <div className="fillet-readout">Arraste para contorno. Segure <strong>Ctrl</strong> e arraste para expandir ou retrair a face em tempo real.</div>
            </>}
            {pathMode && <div className="fillet-readout">Clique no plano para adicionar pontos. Depois use Seguir caminho.</div>}
            {active?.type === "box" && <div className="fillet-readout">Raio atual: <strong>{round(active.filletRadius ?? 0)} mm</strong></div>}
          </section>

          <section className="inspector-section">
            <div className="section-title"><span>Transformação</span><span className="unit-label">global</span></div>
            <div className="sub-heading"><span>Posição</span><span>mm</span></div>
            <div className="fields-grid three">
              <Field label="X" value={activePosition[0]} disabled={!active} onChange={(value) => active && updateVector(active.id, "position", 0, value)} />
              <Field label="Y" value={activePosition[1]} disabled={!active} onChange={(value) => active && updateVector(active.id, "position", 1, value)} />
              <Field label="Z" value={activePosition[2]} disabled={!active} onChange={(value) => active && updateVector(active.id, "position", 2, value)} />
            </div>
            <div className="sub-heading"><span>Rotação</span><span>graus</span></div>
            <div className="fields-grid three">
              <Field label="X" value={activeRotation[0]} suffix="°" disabled={!active} onChange={(value) => active && updateVector(active.id, "rotation", 0, value)} />
              <Field label="Y" value={activeRotation[1]} suffix="°" disabled={!active} onChange={(value) => active && updateVector(active.id, "rotation", 1, value)} />
              <Field label="Z" value={activeRotation[2]} suffix="°" disabled={!active} onChange={(value) => active && updateVector(active.id, "rotation", 2, value)} />
            </div>
            <div className="sub-heading"><span>Escala</span><span>fator</span></div>
            <div className="fields-grid three">
              <Field label="X" value={activeScale[0]} suffix="×" disabled={!active} onChange={(value) => active && updateVector(active.id, "scale", 0, value)} />
              <Field label="Y" value={activeScale[1]} suffix="×" disabled={!active} onChange={(value) => active && updateVector(active.id, "scale", 1, value)} />
              <Field label="Z" value={activeScale[2]} suffix="×" disabled={!active} onChange={(value) => active && updateVector(active.id, "scale", 2, value)} />
            </div>
          </section>

          <section className="inspector-section object-list-section">
            <div className="section-title"><span>Objetos na cena</span><span className="unit-label">{objects.length}</span></div>
            <div className="object-list">
              {objects.map((item) => <button key={item.id} className={`object-row ${selectedIds.includes(item.id) ? "active" : ""}`} onClick={(event) => setSelectedIds((current) => event.shiftKey ? current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id] : [item.id])}><span className="object-swatch" style={{ background: item.color }} /><span className="object-row-copy"><strong>{item.name}</strong><small>{modelLabel(item)} · {item.dimensions.join(" × ")} mm{item.anchorTo ? " · ancorado" : ""}</small></span><span className={invalidIds.has(item.id) ? "object-alert" : "object-check"}>{invalidIds.has(item.id) ? "!" : "✓"}</span></button>)}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

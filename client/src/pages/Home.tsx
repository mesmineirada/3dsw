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

type ShapeType = "box" | "cylinder" | "sphere" | "cone" | "prism" | "boolean";
type ToolMode = "translate" | "rotate" | "scale";
type BooleanMode = "union" | "subtract" | "intersect";
type ComponentRole = "conduit" | "lockPin" | "counterLock";
type Vec3 = [number, number, number];

type GeometryData = {
  positions: number[];
  indices?: number[];
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
  boolean: "Sólido combinado",
};

const componentLabels: Record<ComponentRole, string> = {
  conduit: "Conduto",
  lockPin: "Pino de trava",
  counterLock: "Contra-trava",
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
  switch (model.type) {
    case "cylinder":
      return new THREE.CylinderGeometry(width / 2, width / 2, height, 48);
    case "sphere":
      return new THREE.SphereGeometry(0.5, 48, 32).scale(width, height, depth);
    case "cone":
      return new THREE.ConeGeometry(width / 2, height, 48);
    case "prism":
      return new THREE.CylinderGeometry(width / 2, width / 2, height, 6);
    case "box":
    default:
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

  const applyPushPull = useCallback(() => {
    if (!active) {
      toast.info("Selecione uma peça para usar Puxar/empurrar");
      return;
    }
    if (active.type === "boolean") {
      toast.info("Puxar/empurrar funciona em peças primitivas");
      return;
    }
    const nextHeight = Math.max(1, round(active.dimensions[1] + pushPullAmount));
    const heightDelta = (nextHeight - active.dimensions[1]) / 2;
    const nextPosition: Vec3 = [active.position[0], round(active.position[1] + heightDelta), active.position[2]];
    commit(objectsRef.current.map((item) => {
      if (item.id === active.id) return { ...item, dimensions: [item.dimensions[0], nextHeight, item.dimensions[2]] as Vec3, position: nextPosition };
      if (item.anchorTo !== active.id) return item;
      return { ...item, position: item.position.map((value, index) => round(value + (index === 1 ? heightDelta : 0))) as Vec3 };
    }));
    toast.success(`${pushPullAmount >= 0 ? "Puxado" : "Empurrado"} ${Math.abs(pushPullAmount)} mm`);
  }, [active, commit, pushPullAmount]);

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
    const radius = active.filletRadius && active.filletRadius > 0 ? active.filletRadius : Math.min(6, maxRadius);
    updateModel(active.id, { filletRadius: round(Math.min(radius, maxRadius)) });
    toast.success(`Bordas arredondadas com raio de ${round(Math.min(radius, maxRadius))} mm`);
  }, [active, updateModel]);

  const addPrimitive = useCallback((type: Exclude<ShapeType, "boolean">) => {
    const next = createModel(type, objectsRef.current.length);
    commit([...objectsRef.current, next]);
    setSelectedIds([next.id]);
    toast.success(`${typeLabels[type]} adicionado`);
  }, [commit]);

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
        opacity: selectedIds.includes(model.id) ? 0.95 : 0.88,
      });
      const mesh = new THREE.Mesh(makeGeometry(model), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.modelId = model.id;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 28),
        new THREE.LineBasicMaterial({ color: selectedIds.includes(model.id) ? "#ffffff" : "#101c27", transparent: true, opacity: selectedIds.includes(model.id) ? 0.8 : 0.4 }),
      );
      group.add(mesh, edges);
      scene.add(group);
      meshMapRef.current.set(model.id, group);
    });
    if (selectionHelperRef.current) scene.remove(selectionHelperRef.current);
    if (activeId && meshMapRef.current.has(activeId)) {
      const helper = new THREE.BoxHelper(meshMapRef.current.get(activeId)!, "#f2c76e");
      helper.material.transparent = true;
      helper.material.opacity = 0.95;
      scene.add(helper);
      selectionHelperRef.current = helper;
      transform.attach(meshMapRef.current.get(activeId)!);
      transform.setMode(tool);
    } else {
      transform.detach();
      selectionHelperRef.current = null;
    }
  }, [activeId, objects, selectedIds, tool]);

  const handleCanvasPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera) return;
    const rect = canvas.getBoundingClientRect();
    pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(pointerRef.current, camera);
    const hits = raycasterRef.current.intersectObjects([...meshMapRef.current.values()], true);
    const hit = hits.find((entry) => entry.object.userData.modelId);
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
          </div>

          <div className="rail-divider" />
          <div className="rail-heading"><span>Ferramentas</span><Settings2 size={14} /></div>
          <div className="tool-stack">
            <button className={tool === "translate" ? "selected" : ""} onClick={() => setTool("translate")}><Move3d size={17} /><span>Mover peça</span><kbd>W</kbd></button>
            <button className={tool === "rotate" ? "selected" : ""} onClick={() => setTool("rotate")}><Rotate3d size={17} /><span>Rotacionar</span><kbd>E</kbd></button>
            <button className={tool === "scale" ? "selected" : ""} onClick={() => setTool("scale")}><Maximize2 size={17} /><span>Escalar</span><kbd>R</kbd></button>
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
            <button onClick={applyPushPull} disabled={!active}><Move3d size={16} /><span>Puxar / empurrar</span></button>
            <button onClick={applyFillet} disabled={!active}><Circle size={16} /><span>Arredondar bordas</span></button>
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
            <canvas ref={canvasRef} onPointerDown={handleCanvasPointer} />
            <div className="viewport-hint">{autoClick ? <><span>Autoclique ativo:</span> clique em uma face para criar {componentLabels[placementRole].toLowerCase()}</> : <><span>Arraste</span> para orbitar · <span>Shift + clique</span> para selecionar mais de um</>}</div>
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
            <div className="inspector-actions modeling-actions">
              <button onClick={applyPushPull} disabled={!active}><Move3d size={14} /> Aplicar</button>
              <button onClick={applyFillet} disabled={!active || active.type !== "box"}><Circle size={14} /> Concordância</button>
            </div>
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

import Utils from "../Utils";

const ChangeHistoryService = game.GetService("ChangeHistoryService");

const terrain = game.Workspace.Terrain;

function fillTerrain(requestData: Record<string, unknown>) {
	const material = requestData.material as string;
	const min = requestData.min as number[];
	const max = requestData.max as number[];

	if (!material) return { error: "Material is required" };
	if (!min || !typeIs(min, "table") || (min as defined[]).size() < 3) {
		return { error: "min [x, y, z] is required" };
	}
	if (!max || !typeIs(max, "table") || (max as defined[]).size() < 3) {
		return { error: "max [x, y, z] is required" };
	}

	const materialEnum = (Enum.Material as unknown as Record<string, EnumItem>)[material];
	if (!materialEnum) return { error: `Invalid material: ${material}. Use get_terrain_materials to see available materials.` };

	const [success, result] = pcall(() => {
		const region = new Region3(
			new Vector3((min[0] as number) ?? 0, (min[1] as number) ?? 0, (min[2] as number) ?? 0),
			new Vector3((max[0] as number) ?? 0, (max[1] as number) ?? 0, (max[2] as number) ?? 0),
		);
		const resolution = 4;
		terrain.FillRegion(region.ExpandToGrid(resolution), resolution, materialEnum as Enum.Material);
		ChangeHistoryService.SetWaypoint(`Fill terrain with ${material}`);
		return true;
	});

	if (success) {
		return {
			success: true,
			material,
			min,
			max,
			message: `Terrain filled with ${material}`,
		};
	} else {
		return { error: `Failed to fill terrain: ${result}` };
	}
}

function fillTerrainSphere(requestData: Record<string, unknown>) {
	const material = requestData.material as string;
	const center = requestData.center as number[];
	const radius = requestData.radius as number;

	if (!material) return { error: "Material is required" };
	if (!center || !typeIs(center, "table") || (center as defined[]).size() < 3) {
		return { error: "center [x, y, z] is required" };
	}
	if (!radius || radius <= 0) return { error: "Radius must be a positive number" };

	const materialEnum = (Enum.Material as unknown as Record<string, EnumItem>)[material];
	if (!materialEnum) return { error: `Invalid material: ${material}. Use get_terrain_materials to see available materials.` };

	const [success, result] = pcall(() => {
		const centerVec = new Vector3(
			(center[0] as number) ?? 0,
			(center[1] as number) ?? 0,
			(center[2] as number) ?? 0,
		);
		terrain.FillBall(centerVec, radius, materialEnum as Enum.Material);
		ChangeHistoryService.SetWaypoint(`Fill terrain sphere with ${material}`);
		return true;
	});

	if (success) {
		return {
			success: true,
			material,
			center,
			radius,
			message: `Terrain sphere filled with ${material}`,
		};
	} else {
		return { error: `Failed to fill terrain sphere: ${result}` };
	}
}

function clearTerrain(requestData: Record<string, unknown>) {
	const min = requestData.min as number[] | undefined;
	const max = requestData.max as number[] | undefined;

	const [success, result] = pcall(() => {
		if (min && max && typeIs(min, "table") && typeIs(max, "table") &&
			(min as defined[]).size() >= 3 && (max as defined[]).size() >= 3) {
			const region = new Region3(
				new Vector3((min[0] as number) ?? 0, (min[1] as number) ?? 0, (min[2] as number) ?? 0),
				new Vector3((max[0] as number) ?? 0, (max[1] as number) ?? 0, (max[2] as number) ?? 0),
			);
			const resolution = 4;
			terrain.FillRegion(region.ExpandToGrid(resolution), resolution, Enum.Material.Air);
			ChangeHistoryService.SetWaypoint("Clear terrain region");
			return "region";
		} else {
			terrain.Clear();
			ChangeHistoryService.SetWaypoint("Clear all terrain");
			return "all";
		}
	});

	if (success) {
		return {
			success: true,
			cleared: result,
			message: result === "all" ? "All terrain cleared" : "Terrain region cleared",
		};
	} else {
		return { error: `Failed to clear terrain: ${result}` };
	}
}

function getTerrainMaterials(_requestData: Record<string, unknown>) {
	const materials: string[] = [];

	const [success] = pcall(() => {
		for (const [name] of pairs(Enum.Material.GetEnumItems())) {
			const item = Enum.Material.GetEnumItems()[name as number];
			if (item) {
				materials.push(item.Name);
			}
		}
	});

	if (!success || materials.size() === 0) {
		// Fallback: list common terrain materials
		const commonMaterials = [
			"Air", "Asphalt", "Basalt", "Brick", "Cobblestone", "Concrete",
			"CrackedLava", "Glacier", "Grass", "Ground", "Ice", "LeafyGrass",
			"Limestone", "Mud", "Pavement", "Rock", "Salt", "Sand",
			"Sandstone", "Slate", "Snow", "WoodPlanks", "Water",
		];
		return { success: true, materials: commonMaterials };
	}

	return { success: true, materials };
}

export = {
	fillTerrain,
	fillTerrainSphere,
	clearTerrain,
	getTerrainMaterials,
};

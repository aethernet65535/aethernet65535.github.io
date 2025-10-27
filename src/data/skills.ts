// Skill data configuration file
// Used to manage data for the skill display page

export interface Skill {
	id: string;
	name: string;
	description: string;
	icon: string; // Iconify icon name
	category: "kernel" | "frontend" | "backend" | "database" | "tools" | "other";
	level: "beginner" | "intermediate" | "advanced" | "expert";
	experience: {
		years: number;
		months: number;
	};
	projects?: string[]; // Related project IDs
	certifications?: string[];
	color?: string; // Skill card theme color
}

export const skillsData: Skill[] = [
	// Programming Language
	{
		id: "c",
		name: "C",
		description:
			"A low-level systems programming language, the foundation for operating systems and embedded systems development.",
		icon: "logos:c",
		category: "kernel",
		level: "intermediate",
		experience: { years: 0, months: 9 },
		projects: ["xv6-labs", "kernel-module"],
		color: "#A8B9CC",
	},
	{
		id: "rust",
		name: "Rust",
		description:
			"A systems programming language focusing on safety, speed, and concurrency, with no garbage collector.",
		icon: "logos:rust",
		category: "kernel",
		level: "beginner",
		experience: { years: 0, months: 1 },
		projects: [],
		color: "#CE422B",
	},
	// Tools
	{
		id: "git",
		name: "Git",
		description:
			"A distributed version control system, an essential tool for code management and team collaboration.",
		icon: "logos:git-icon",
		category: "tools",
		level: "beginner",
		experience: { years: 0, months: 8 },
		color: "#F05032",
	},
	{
		id: "nvim",
		name: "NeoVIM",
		description:
			"A powerful text editor with a big community that is constantly growing. Even though the editor is about two decades old, people still extend and want to improve it, mostly using Vimscript or one of the supported scripting languages.",
		icon: "logos:neovim",
		category: "tools",
		level: "beginner",
		experience: { years: 0, months: 8 },
		color: "#007ACC",
	},
	{
		id: "vscode",
		name: "VS Code",
		description:
			"A lightweight but powerful code editor with a rich plugin ecosystem.",
		icon: "logos:visual-studio-code",
		category: "tools",
		level: "beginner",
		experience: { years: 0, months: 9 },
		color: "#007ACC",
	},
	{
		id: "podman",
		name: "PodMan",
		description:
			"A containerization platform that simplifies application deployment and environment management.",
		icon: "logos:docker-icon",
		category: "tools",
		level: "beginner",
		experience: { years: 0, months: 5 },
		color: "#2496ED",
	},
	{
		id: "linux",
		name: "Linux",
		description:
			"An open-source operating system, the preferred choice for server deployment and development environments.",
		icon: "logos:linux-tux",
		category: "tools",
		level: "beginner",
		experience: { years: 0, months: 7 },
		projects: [],
		color: "#FCC624",
	},
];

// Get skill statistics
export const getSkillStats = () => {
	const total = skillsData.length;
	const byLevel = {
		beginner: skillsData.filter((s) => s.level === "beginner").length,
		intermediate: skillsData.filter((s) => s.level === "intermediate").length,
		advanced: skillsData.filter((s) => s.level === "advanced").length,
		expert: skillsData.filter((s) => s.level === "expert").length,
	};
	const byCategory = {
		kernel: skillsData.filter((s) => s.category === "kernel").length,
		/*
		frontend: skillsData.filter((s) => s.category === "frontend").length,
		backend: skillsData.filter((s) => s.category === "backend").length,
		database: skillsData.filter((s) => s.category === "database").length,
		*/
		tools: skillsData.filter((s) => s.category === "tools").length,
		other: skillsData.filter((s) => s.category === "other").length,
	};

	return { total, byLevel, byCategory };
};

// Get skills by category
export const getSkillsByCategory = (category?: string) => {
	if (!category || category === "all") {
		return skillsData;
	}
	return skillsData.filter((s) => s.category === category);
};

// Get advanced skills
export const getAdvancedSkills = () => {
	return skillsData.filter(
		(s) => s.level === "advanced" || s.level === "expert",
	);
};

// 找到经验最长的技能（按年再按月比较）
export const getTotalExperience = () => {
  if (!skillsData || skillsData.length === 0) {
    return { years: 0, months: 0 };
  }

  // 用 reduce 找出最久的技能
  const longest = skillsData.reduce((max, skill) => {
    const maxTotal = max.experience.years * 12 + max.experience.months;
    const curTotal = skill.experience.years * 12 + skill.experience.months;

    // 比较总月数，返回更久的那个
    return curTotal > maxTotal ? skill : max;
  });

  // 返回最长的年和月
  return {
    years: longest.experience.years,
    months: longest.experience.months,
  };
};

const TaskForm = ({
  projectId,
  setProjectId,
  projectTaskId,
  setProjectTaskId,
  description,
  setDescription,
  handleKeyDown,
  projects,
  tasks,
}) => {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="projectId"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Project
          </label>
          <select
            id="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Select a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="projectTaskId"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Task
          </label>
          <select
            id="projectTaskId"
            value={projectTaskId}
            onChange={(e) => setProjectTaskId(e.target.value)}
            disabled={!projectId}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Select a task</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Task Description
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={100}
          rows={3}
          className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
          placeholder="What task(s) are you doing? (max 100 characters)"
        ></textarea>
      </div>
    </div>
  );
};

export default TaskForm;

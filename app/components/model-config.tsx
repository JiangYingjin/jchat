import { ModalConfigValidator, ModelConfig } from "../store";

import Locale from "../locales";
import { InputRange } from "./input-range";
import { ListItem, Select } from "./ui-lib";
import { useAllModels } from "../utils/hooks";

export function ModelConfigList(props: {
  modelConfig: ModelConfig;
  updateConfig: (updater: (config: ModelConfig) => void) => void;
}) {
  const allModels = useAllModels();
  const value = props.modelConfig.model;

  return (
    <>
      <ListItem title={Locale.Settings.Model}>
        <Select
          aria-label={Locale.Settings.Model}
          value={value}
          align="left"
          onChange={(e) => {
            props.updateConfig((config) => {
              config.model = ModalConfigValidator.model(e.currentTarget.value);
            });
          }}
        >
          {allModels.map((v, i) => (
            <option value={v.name} key={i}>
              {v.name}
            </option>
          ))}
        </Select>
      </ListItem>
    </>
  );
}

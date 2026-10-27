import { useAppInfo } from 'lib/hooks/api/appConfig';
import React from 'react';
import { ApplicationInfoEnabledFeaturesEnum } from 'generated-sources';
import { useNavigate } from 'react-router-dom';

interface GlobalSettingsContextProps {
  hasDynamicConfig: boolean;
  isLoading: boolean;
}

export const GlobalSettingsContext =
  React.createContext<GlobalSettingsContextProps>({
    hasDynamicConfig: false,
    isLoading: true,
  });

export const GlobalSettingsProvider: React.FC<
  React.PropsWithChildren<unknown>
> = ({ children }) => {
  const info = useAppInfo();
  const navigate = useNavigate();
  const [hasDynamicConfig, setHasDynamicConfig] = React.useState(false);

  React.useEffect(() => {
    if (info.data?.redirect && !info.isFetching) {
      navigate('login');
      return;
    }

    const features = info?.data?.response?.enabledFeatures;

    if (features) {
      setHasDynamicConfig(
        features.includes(ApplicationInfoEnabledFeaturesEnum.DYNAMIC_CONFIG)
      );
    }
  }, [info.data]);

  return (
    <GlobalSettingsContext.Provider
      value={{ hasDynamicConfig, isLoading: info.isLoading }}
    >
      {children}
    </GlobalSettingsContext.Provider>
  );
};
